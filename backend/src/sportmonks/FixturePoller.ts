import {Logger} from "../Logger";
import {JobContext} from "../Logger/Context";
import {FixtureSelectionProvider} from "./FixtureSelectionProvider";
import {LiveSnapshotStore} from "./LiveSnapshotStore";
import {FixturesClient} from "./clients/FixturesClient";
import {
    sportmonksActiveFixtureIds,
    sportmonksPollerLastSuccessTimestamp,
} from "./metrics";
import {LiveFixture} from "./types";

export interface FixturePollerOptions {
    /** Polling cadence in milliseconds. From `SPORTMONKS_POLL_INTERVAL_MS`. */
    intervalMs: number;
    /** Max IDs per `/fixtures/multi` call. From `SPORTMONKS_MULTI_FIXTURE_BATCH_SIZE`. */
    batchSize: number;
    /**
     * Optional hook invoked at the end of every tick — after the
     * `LiveSnapshotStore` writes have settled, regardless of whether the
     * tick succeeded or threw. Used by the overlay SSE bridge (ADR 0006)
     * to broadcast fresh snapshots to subscribers without coupling the
     * poller to that mechanism. Errors thrown from the hook are caught
     * and logged so they cannot crash the loop.
     */
    onTickFinished?: () => void | Promise<void>;
}

/**
 * Background loop that refreshes the live snapshot for every fixture in the
 * active set on a fixed cadence.
 *
 * Implementation notes (per ADR 0001 + issue #7):
 *   - `setTimeout` recursion is used instead of `setInterval` so ticks
 *     **never overlap** — the next tick is only scheduled once the previous
 *     one completes (success or failure).
 *   - Errors inside a tick are caught and logged; the loop continues. We do
 *     not re-increment `sportmonks_api_calls_total{status="error"}` here
 *     because `SportmonksHttpClient.get()` (called via `FixturesClient`)
 *     already increments it on failure.
 *   - `sportmonks_poller_last_success_timestamp` is only updated when every
 *     batch in a tick succeeded (or the active set was empty).
 *   - `stop()` returns a promise that resolves once any in-flight tick has
 *     finished, so callers can `await poller.stop()` during graceful shutdown.
 */
export class FixturePoller {

    private readonly logger = new Logger("FixturePoller");
    private timeoutHandle: NodeJS.Timeout | undefined;
    private stopped: boolean = false;
    private started: boolean = false;
    /** Resolves once a currently-running tick (if any) has finished. */
    private inFlight: Promise<void> | undefined;

    constructor(
        private readonly client: FixturesClient,
        private readonly provider: FixtureSelectionProvider,
        private readonly store: LiveSnapshotStore,
        private readonly options: FixturePollerOptions,
    ) {}

    /**
     * Begin polling. Idempotent — a second call logs a warning and returns
     * without scheduling a duplicate tick.
     */
    start(): void {
        const ctx = new JobContext();
        if (this.started) {
            this.logger.warning(ctx, "FixturePoller.start() called twice — ignoring");
            return;
        }
        this.started = true;
        this.stopped = false;
        this.logger.info(ctx, "FixturePoller started", {
            interval_ms: this.options.intervalMs,
            batch_size: this.options.batchSize,
        });
        this.scheduleNext();
    }

    /**
     * Stop polling. Clears any pending timer, prevents future ticks from
     * being scheduled, and waits for an in-flight tick to finish so the
     * caller can shut down deterministically.
     */
    async stop(): Promise<void> {
        const ctx = new JobContext();
        if (!this.started) {
            return;
        }
        this.stopped = true;
        if (this.timeoutHandle !== undefined) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
        if (this.inFlight !== undefined) {
            try {
                await this.inFlight;
            } catch {
                // Errors from the tick are already logged; ignore here so
                // shutdown remains deterministic.
            }
        }
        this.started = false;
        this.logger.info(ctx, "FixturePoller stopped");
    }

    private scheduleNext(): void {
        if (this.stopped) {
            return;
        }
        this.timeoutHandle = setTimeout(() => {
            this.timeoutHandle = undefined;
            this.inFlight = this.runTick().finally(() => {
                this.inFlight = undefined;
                // Schedule the next tick after success or failure, unless
                // we've been stopped in the meantime.
                this.scheduleNext();
            });
        }, this.options.intervalMs);
    }

    private async runTick(): Promise<void> {
        const ctx = new JobContext();
        try {
            const activeIds = await this.provider.getActiveFixtureIds();

            if (activeIds.length === 0) {
                // Empty active set — no API call, but keep the gauges and
                // the snapshot store in sync so consumers can tell we're
                // tracking nothing right now.
                this.store.evictMissing([]);
                sportmonksActiveFixtureIds.set(0);
                sportmonksPollerLastSuccessTimestamp.set(Math.floor(Date.now() / 1000));
                return;
            }

            const batches = this.chunk(activeIds, this.options.batchSize);
            const collected: LiveFixture[] = [];
            for (const batch of batches) {
                const fixtures = await this.client.getMulti<LiveFixture>(batch, {
                    // `periods` (ADR 0006): the ticking period carries the
                    // authoritative live match minute the overlay timer needs.
                    includes: ["scores", "state", "events", "participants", "statistics", "periods"],
                });
                if (Array.isArray(fixtures)) {
                    for (const fixture of fixtures) {
                        collected.push(fixture);
                    }
                }
            }

            this.store.replaceMany(collected);
            this.store.evictMissing(activeIds);
            sportmonksActiveFixtureIds.set(activeIds.length);
            sportmonksPollerLastSuccessTimestamp.set(Math.floor(Date.now() / 1000));
        } catch (e) {
            // The client already increments `sportmonks_api_calls_total{status="error"}`
            // on HTTP/parse failures — don't double-count here. We just log
            // and let the loop continue on the next tick.
            const message = e instanceof Error ? e.message : String(e);
            this.logger.error(ctx, "FixturePoller tick failed", {error: message});
        }

        // `onTickFinished` runs whether the tick succeeded or threw — the
        // overlay bridge wants to fan out even a stale snapshot rather than
        // pause broadcasts during transient SportMonks failures. Errors from
        // the hook itself are isolated so they can't break the poll loop.
        if (this.options.onTickFinished !== undefined) {
            try {
                await this.options.onTickFinished();
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                this.logger.error(ctx, "FixturePoller onTickFinished failed", {error: message});
            }
        }
    }

    private chunk<T>(items: T[], size: number): T[][] {
        if (size <= 0) {
            return [items.slice()];
        }
        const result: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
            result.push(items.slice(i, i + size));
        }
        return result;
    }
}

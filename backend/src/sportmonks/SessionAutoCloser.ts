import {Logger} from "../Logger";
import {ContextFactory} from "../Logger/Context";
import {SessionRepository} from "../database/repositories/SessionRepository";
import {LiveSnapshotStore} from "./LiveSnapshotStore";
import {isFixtureFinished} from "./isFixtureFinished";

export interface SessionAutoCloserOptions {
    /** Tick cadence in milliseconds. From `SESSION_AUTOCLOSE_INTERVAL_MS`. */
    intervalMs: number;
}

/**
 * Background loop that ends sessions whose attached fixtures are all in a
 * terminal SportMonks state (ADR 0005 §2). Mirrors `FixturePoller`'s
 * `setTimeout`-recursion shape so ticks never overlap and `stop()` can drain
 * an in-flight tick for deterministic shutdown.
 *
 * The closer is intentionally decoupled from the poller's 5s cadence — it
 * runs less often (default 30s) because "session has ended" doesn't need
 * sub-poll latency, and a less frequent tick avoids hammering the DB.
 *
 * Predicate (per ADR): a session is ended only when
 *   (a) it has ≥1 attached fixture, AND
 *   (b) every attached fixture has a snapshot in `LiveSnapshotStore`, AND
 *   (c) every such snapshot's `state.short_name` is in the terminal set.
 *
 * Missing snapshots block auto-end — we don't guess. They'll fill in within
 * a few poll ticks for any fixture in range, and the next auto-close tick
 * will re-evaluate.
 */
export class SessionAutoCloser {

    private readonly logger = new Logger("SessionAutoCloser");
    private timeoutHandle: NodeJS.Timeout | undefined;
    private stopped: boolean = false;
    private started: boolean = false;
    /** Resolves once a currently-running tick (if any) has finished. */
    private inFlight: Promise<void> | undefined;

    constructor(
        private readonly sessionRepository: SessionRepository,
        private readonly snapshotStore: LiveSnapshotStore,
        private readonly options: SessionAutoCloserOptions,
    ) {}

    /**
     * Begin running. Idempotent — a second call logs a warning and returns
     * without scheduling a duplicate tick.
     */
    start(): void {
        const ctx = ContextFactory.createProcessContext("session-auto-closer");
        if (this.started) {
            this.logger.warning(ctx, "SessionAutoCloser.start() called twice — ignoring");
            return;
        }
        this.started = true;
        this.stopped = false;
        this.logger.info(ctx, "SessionAutoCloser started", {
            interval_ms: this.options.intervalMs,
        });
        this.scheduleNext();
    }

    /**
     * Stop running. Clears any pending timer, prevents future ticks from
     * being scheduled, and waits for an in-flight tick to finish so the
     * caller can shut down deterministically.
     */
    async stop(): Promise<void> {
        const ctx = ContextFactory.createProcessContext("session-auto-closer");
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
        this.logger.info(ctx, "SessionAutoCloser stopped");
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

    /**
     * Public for testability — invoke directly to step the loop one tick
     * without waiting on `setTimeout`. The instance does not need to be
     * `start()`ed to call this.
     */
    async runTick(): Promise<void> {
        const ctx = ContextFactory.createProcessContext("session-auto-closer");
        try {
            const sessions = await this.sessionRepository.findActiveWithFixtureIds();
            let endedCount = 0;
            for (const {sessionId, userId, fixtureIds} of sessions) {
                if (!this.shouldEnd(fixtureIds)) {
                    continue;
                }
                const result = await this.sessionRepository.markEnded(sessionId, userId);
                if (result.status === 'ended') {
                    endedCount++;
                    this.logger.info(ctx, "Session auto-ended", {
                        session_id: sessionId,
                        user_id: userId,
                        fixture_count: fixtureIds.length,
                    });
                }
                // 'already_ended' and 'not_found' are no-ops here — the closer
                // is best-effort and the next tick will reflect reality.
            }
            if (endedCount > 0) {
                this.logger.info(ctx, "SessionAutoCloser tick complete", {
                    ended_count: endedCount,
                    scanned: sessions.length,
                });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.logger.error(ctx, "SessionAutoCloser tick failed", {error: message});
        }
    }

    /**
     * Apply the ADR's three-part predicate. A session ends only when it has
     * at least one fixture AND every fixture has a snapshot AND every
     * snapshot is in a terminal state.
     */
    private shouldEnd(fixtureIds: number[]): boolean {
        if (fixtureIds.length === 0) {
            return false;
        }
        const snaps = this.snapshotStore.getMany(fixtureIds);
        // `getMany` skips IDs missing from the store, so a length mismatch
        // means at least one fixture has no snapshot yet — don't guess.
        if (snaps.length !== fixtureIds.length) {
            return false;
        }
        return snaps.every(isFixtureFinished);
    }
}

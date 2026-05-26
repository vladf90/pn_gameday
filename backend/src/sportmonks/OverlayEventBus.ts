import {PublicOverlayResponse} from "../controller/SessionController";

/**
 * Snapshot payload broadcast to overlay subscribers (ADR 0006 §1).
 *
 * Extends the existing `PublicOverlayResponse` with a `serverTime` field
 * (epoch ms at broadcast time) so the client can derive a stable clock
 * skew and tick the match minute smoothly between server updates.
 */
export type OverlayPayload = PublicOverlayResponse & { serverTime: number };

/**
 * A subscriber callback: writes one SSE frame to the underlying response
 * and returns `false` if the socket has been closed (so the bus can evict
 * the dead writer). Throwing is also treated as a dead writer.
 */
export type OverlayWriter = (payload: OverlayPayload) => boolean;

/**
 * Per-session pub/sub for the public overlay SSE stream (ADR 0006 §2).
 *
 * Each open `GET /public/sessions/:id/overlay/stream` connection registers
 * one writer for its session id. The `FixturePoller`'s `onTickFinished`
 * hook (wired in `Bootstrap`) iterates the bus's currently-subscribed
 * session ids and calls `broadcast(sessionId, payload)` for each — so we
 * only do per-tick work for sessions someone is actually watching.
 *
 * Single-tenant per session (ADR 0008): at most ONE writer per session
 * id at a time. A new `subscribe` for an already-occupied session evicts
 * the previous writer by sending it a synthetic terminal frame
 * (`endedAt = new Date(0)`) — the writer recognises `endedAt !== null`
 * (see `SessionController.streamPublicOverlay`'s `writeFrame`) and closes
 * its SSE response. The new subscriber then takes the slot. This is what
 * makes "open the overlay URL again in a new tab kicks the old tab" work.
 *
 * Intentionally trivial:
 *   - In-memory only; restarts drop all subscriptions and clients auto-reconnect.
 *   - No queueing or back-pressure: a writer that returns `false` (or throws)
 *     is removed immediately. Slow clients are dropped, not buffered.
 *   - No diff/coalesce logic: every poll tick broadcasts a fresh full payload.
 *     The payload is small (a few KB) so simplicity wins over bandwidth shaving.
 */
export class OverlayEventBus {
    // sessionId -> the single active writer.
    private readonly writers: Map<number, OverlayWriter> = new Map();

    /**
     * Install `writer` as the active subscriber for `sessionId`. If a
     * previous writer is registered, it is evicted with a synthetic
     * terminal frame so its SSE response closes cleanly (ADR 0008).
     *
     * Returns an unsubscribe function the caller MUST invoke when the
     * underlying response closes (typically inside `req.on('close', ...)`).
     * The unsubscribe is a no-op if a later `subscribe` call has already
     * displaced this writer — we don't want to delete someone else's slot.
     */
    subscribe(sessionId: number, writer: OverlayWriter): () => void {
        const prior = this.writers.get(sessionId);
        if (prior !== undefined && prior !== writer) {
            // Best-effort eviction frame. We don't care whether the prior
            // writer returns `true`/`false` or throws — it's being replaced
            // either way. `endedAt: new Date(0)` is the signal the SSE
            // writer in `SessionController` keys off to close the response.
            try {
                prior({
                    sessionId,
                    name: "",
                    endedAt: new Date(0),
                    fixtures: [],
                    missingFixtureIds: [],
                    serverTime: Date.now(),
                });
            } catch {
                // Swallow — the prior writer is going away regardless.
            }
        }
        this.writers.set(sessionId, writer);
        return () => {
            // Only delete if the slot still holds *this* writer. A later
            // subscribe may have already displaced us, in which case the
            // newer subscriber owns the slot and we mustn't touch it.
            if (this.writers.get(sessionId) === writer) {
                this.writers.delete(sessionId);
            }
        };
    }

    /**
     * Push a payload to the single writer subscribed to `sessionId`. If
     * the writer returns `false` or throws, it is evicted in place — this
     * is how a dead socket falls off the registry without an explicit
     * unsubscribe call.
     */
    broadcast(sessionId: number, payload: OverlayPayload): void {
        const writer = this.writers.get(sessionId);
        if (writer === undefined) {
            return;
        }
        let alive = false;
        try {
            alive = writer(payload);
        } catch {
            alive = false;
        }
        if (!alive) {
            // Guard against a same-tick `subscribe` having already
            // replaced our writer — don't evict the new one.
            if (this.writers.get(sessionId) === writer) {
                this.writers.delete(sessionId);
            }
        }
    }

    /**
     * Snapshot of session ids that currently have an active writer. The
     * poller hook uses this to skip per-session payload assembly for
     * sessions no one is watching.
     */
    subscribedSessionIds(): number[] {
        return Array.from(this.writers.keys());
    }
}

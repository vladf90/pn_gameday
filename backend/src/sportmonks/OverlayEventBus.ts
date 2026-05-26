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
 * Intentionally trivial:
 *   - In-memory only; restarts drop all subscriptions and clients auto-reconnect.
 *   - No queueing or back-pressure: a writer that returns `false` (or throws)
 *     is removed from the set immediately. Slow clients are dropped, not buffered.
 *   - No diff/coalesce logic: every poll tick broadcasts a fresh full payload.
 *     The payload is small (a few KB) and viewer counts are bounded by the
 *     number of host streams, so the simplicity wins over bandwidth shaving.
 */
export class OverlayEventBus {
    // sessionId -> set of writer callbacks.
    private readonly subscribers: Map<number, Set<OverlayWriter>> = new Map();

    /**
     * Add a writer for `sessionId`. Returns an unsubscribe function the
     * caller MUST invoke when the underlying response closes (typically
     * inside `req.on('close', ...)`).
     */
    subscribe(sessionId: number, writer: OverlayWriter): () => void {
        let set = this.subscribers.get(sessionId);
        if (set === undefined) {
            set = new Set();
            this.subscribers.set(sessionId, set);
        }
        set.add(writer);
        return () => {
            const current = this.subscribers.get(sessionId);
            if (current === undefined) {
                return;
            }
            current.delete(writer);
            if (current.size === 0) {
                this.subscribers.delete(sessionId);
            }
        };
    }

    /**
     * Push a payload to every writer subscribed to `sessionId`. Writers
     * that return `false` or throw are evicted in-place — this is the
     * mechanism by which dead sockets fall off the subscription set
     * without an explicit unsubscribe call.
     */
    broadcast(sessionId: number, payload: OverlayPayload): void {
        const set = this.subscribers.get(sessionId);
        if (set === undefined || set.size === 0) {
            return;
        }
        // Snapshot the writers before iterating so an evicting writer
        // (which mutates the underlying set) doesn't perturb iteration.
        const writers = Array.from(set);
        for (const writer of writers) {
            let alive = false;
            try {
                alive = writer(payload);
            } catch {
                alive = false;
            }
            if (!alive) {
                set.delete(writer);
            }
        }
        if (set.size === 0) {
            this.subscribers.delete(sessionId);
        }
    }

    /**
     * Snapshot of session ids that currently have at least one subscriber.
     * The poller hook uses this to skip per-session payload assembly for
     * sessions no one is watching.
     */
    subscribedSessionIds(): number[] {
        return Array.from(this.subscribers.keys());
    }
}

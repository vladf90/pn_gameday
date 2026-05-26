# ADR 0006 — Overlay Live Updates and Match Timer

- **Status:** Proposed
- **Date:** 2026-05-26
- **Author:** Vlad Foamete
- **Builds on:** [ADR 0001](0001-sportmonks-integration.md), [ADR 0005](0005-watchalong-sessions.md)

## Context

The OBS overlay shipped in ADR 0005 ([`OverlayPage.tsx`](../../frontend/src/Components/overlay/OverlayPage.tsx)) renders score and a small state badge (`HT`, `FT`, `NS`), polled every 5 seconds from `GET /public/sessions/:id/overlay`. Two gaps make it feel inert on-stream:

1. **No match minute.** Viewers see the score and the literal state code, but not "47'" — so the overlay looks frozen between goals even when the match is well underway.
2. **Coarse update latency.** A score change can take up to ~10s to reach the screen (5s backend poll cadence + up to 5s client-poll skew). On-stream that is long enough for a commentator to react before the scoreboard catches up — exactly the wrong order of events.

The data needed already exists in the [`LiveSnapshotStore`](../../backend/src/sportmonks/LiveSnapshotStore.ts): the SportMonks `include=state;periods` payload carries the in-play minute, the [`FixturePoller`](../../backend/src/sportmonks/FixturePoller.ts) refreshes it every 5s, and the overlay route already proxies the snapshot subset. The work is plumbing — exposing it cheaply and ticking it smoothly on the client.

## Decision

### 1. Transport: Server-Sent Events from backend, replacing polling

Add a new public SSE endpoint:

```
GET /public/sessions/:id/overlay/stream
```

Mounted on [`NoAuthRouter`](../../backend/src/router/NoAuthRouter.ts) alongside the existing `/public/sessions/:id/overlay` JSON endpoint. The JSON endpoint stays — it's still useful as a one-shot fetch for tests/curl — but `OverlayPage` switches to consume the SSE stream instead of polling.

**Why SSE over WebSocket:** one-way push, native browser support (`EventSource`), automatic reconnect with `Last-Event-ID`, no protocol upgrade dance, works fine through Express without an extra dependency. We never need the overlay to *send* anything to the server.

**Replace, don't augment:** the overlay only ever uses SSE; if SSE is blocked by a hostile proxy, we accept a broken overlay rather than carrying two render paths. Lower test surface, fewer race conditions between push and poll updating state out of order. (`EventSource` will auto-reconnect indefinitely on transient drops, which covers the realistic failure modes.)

### 2. Backend push cadence: piggy-back on the existing poll tick

The `FixturePoller` already updates `LiveSnapshotStore` every 5s. A new lightweight broadcaster — `OverlayEventBus` — sits next to the store and emits one event per session whenever the poller finishes a tick. Each open SSE connection is subscribed for a specific session id; it receives the same `{ sessionId, name, endedAt, fixtures, missingFixtureIds, serverTime }` payload the JSON endpoint returns, plus a `serverTime` epoch-ms field used for client-side clock alignment.

We push on **every** tick (not just on diff) — the overlay payload is small (a few KB per session) and concurrent overlay viewer counts are bounded by the number of host streams. A diff-based push would add cache-state to the broadcaster and a "no event yet" race on initial connect; the simple cadence-based approach has neither problem.

The initial event is sent on connect — synthesized from the current snapshot store — so the overlay renders immediately without waiting up to 5s for the first poll tick.

### 3. Timer: MM:SS, client-ticked from a minute-granularity source

The overlay displays a single timer chip per fixture, formatted `MM:SS` (e.g. `47:32`):

- **When SportMonks reports an in-play state** (`1H`, `2H`, `ET1`, `ET2`, `PEN`, `INPLAY`), show a running `MM:SS` clock. The minute comes from the SportMonks `periods` block — that's our authoritative source. **Seconds are extrapolated on the client** because SportMonks gives us minute precision only. The client runs `setInterval(1000)` to advance the displayed seconds; each SSE event refreshes the authoritative minute.
- **When in a paused-but-running state** (`HT`, half-time / `BREAK`), show the literal state badge (`HT`).
- **When the match is finished** (`FT`, `AET`, `FT_PEN`, etc.), show the terminal state badge (`FT`).
- **When not yet started** (`NS`, `TBA`), show the kickoff time from `fixture.starting_at` rendered in the viewer's local time (`19:30`). If no `starting_at` is available, fall back to the existing state badge.
- **Fallback** for unknown states: show the state's `short_name` as today.

**Precision and re-sync behaviour.** Because the upstream is minute-granular and we poll every 5s, the displayed seconds are inherently a *local extrapolation* — they can be ±5s out of sync with the real broadcast clock at any moment. We accept this; tightening it would require a higher-frequency upstream we don't have.

The client maintains a logical clock `(referenceMinute, referenceWallTime)`. On each tick, the displayed time is computed as:

```
elapsedSeconds = (now - referenceWallTime) / 1000
displayedTotalSeconds = referenceMinute * 60 + elapsedSeconds
displayed = `${floor(total/60)}:${pad(total % 60)}`
```

When a new SSE event arrives:

- Compute `expectedMinute = floor(displayedTotalSeconds / 60)`.
- If `|authoritativeMinute - expectedMinute| <= 1`, **keep ticking smoothly** — the clock might disagree with the authoritative minute by a few seconds but never visibly jumps. This is the common case (poll cadence is 5s, drift accumulates slowly).
- If the drift exceeds 1 minute, **snap** the clock to `authoritativeMinute:00`. This is the safety net for cases like the poller failing for a long stretch, the host attaching a fixture that's already in the second half, or a fixture skipping states (HT → 2H without us seeing the transition).

Net effect: in steady-state the clock ticks smoothly without visible jumps; in pathological cases it self-corrects rather than drifting unboundedly. Drift well under the host's stated "anything under ~2 minutes is fine" tolerance.

Because the timer is driven entirely on the frontend from `(authoritativeMinute, capturedAt)`, the backend never has to emit per-second ticks — push cost stays at 1 event per session per 5s, regardless of viewer count.

### 4. Session ended: stream closes, last frame stays on screen

When a session is ended (either auto-closed by `SessionAutoCloser` or force-ended via `POST /sessions/:id/end`), the backend pushes one final event with `endedAt` set and then closes the SSE stream from the server side. The client's `EventSource.onerror` is suppressed for this case (because the server explicitly hung up). The overlay shows whatever final snapshot was last delivered — the score does **not** flip to a "session ended" message; the host's broadcast keeps the final score visible until they remove the Browser Source.

This matches the host's stated preference: a clean static final-score frame, no further updates, no "ended" overlay text replacing the score.

### Rejected alternatives

- **WebSocket transport.** Heavier protocol, no browser-native reconnect, and we never need client→server messages.
- **Backend emits per-second `tick` events.** Pushes per-second traffic that scales with `(open_overlays × 1Hz)` for zero perceptual benefit — the client can derive the same minute locally from `(authoritativeMinute, serverTime)`.
- **Diff-based broadcast (push only on change).** Adds cache-state to the broadcaster and an initial-event race. Bandwidth saving is negligible against the 5s cadence.
- **Server pushes a `session_ended` overlay frame.** Host wants the final score to stay clean on stream — switching to an "ended" message overlay is the opposite.
- **Drop the polling endpoint entirely.** Useful for ops/test/curl; keeping it costs almost nothing and lets us debug overlay payloads without a browser.
- **Track minute purely on the client from `starting_at`.** Wrong during stoppage, half-time, extra time, abandonment — we have the authoritative minute on the server, we should use it.

## Technical Approach

### Files

```
backend/src/
├── Bootstrap.ts                                       # wire OverlayEventBus, register SSE route,
│                                                     # hook poller post-tick to broadcaster
├── controller/SessionController.ts                   # add streamPublicOverlay handler
├── router/NoAuthRouter.ts                            # SSE-aware response path (see §SSE plumbing)
├── sportmonks/
│   ├── FixturePoller.ts                              # accept optional onTick callback; invoke
│   │                                                 # after store.replaceMany/evictMissing
│   └── OverlayEventBus.ts                            # NEW — per-session subscriber list, push API
frontend/src/
├── clients/OverlayRequestClient.ts                   # add subscribeStream() returning EventSource
├── Components/overlay/OverlayPage.tsx                # swap polling for EventSource; timer chip
└── Components/overlay/MatchTimer.tsx                 # NEW — minute-or-elapsed display, ticks 1s
docs/adr/
└── 0006-overlay-live-updates-and-timer.md           # this file
```

No DB schema changes, no migrations, no new env vars.

### OverlayEventBus shape

```ts
type OverlayPayload = PublicOverlayResponse & { serverTime: number };

class OverlayEventBus {
    // sessionId -> set of writer callbacks (each callback writes one SSE frame
    // and returns false if the underlying socket has closed).
    private readonly subscribers = new Map<number, Set<(payload: OverlayPayload) => boolean>>();

    subscribe(sessionId: number, writer: (payload: OverlayPayload) => boolean): () => void {
        const set = this.subscribers.get(sessionId) ?? new Set();
        set.add(writer);
        this.subscribers.set(sessionId, set);
        return () => {
            set.delete(writer);
            if (set.size === 0) this.subscribers.delete(sessionId);
        };
    }

    broadcast(sessionId: number, payload: OverlayPayload): void {
        const set = this.subscribers.get(sessionId);
        if (!set) return;
        for (const writer of set) {
            if (!writer(payload)) set.delete(writer);
        }
    }
}
```

### Poller integration

Extend `FixturePollerOptions` with an optional `onTickFinished?: () => void | Promise<void>`, invoked after `replaceMany` + `evictMissing` so subscribers always see the freshest snapshot. The poller itself stays unaware of overlays — `Bootstrap.ts` wires the callback to "for each active session id with at least one connected overlay, build a snapshot payload and `bus.broadcast(...)`".

Implementation note: the broadcaster iterates `subscribers.keys()`, not all sessions; we only do work for sessions someone is actually watching.

### SSE plumbing in the controller

The new handler does **not** route through `BaseRouter`'s `{ data, code, message }` wrapper — SSE needs raw `res` control. Two options:

1. **Add an `sse` helper to `BaseRouter`** that sets the headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`), flushes, and exposes the raw response for the handler to write frames into. Other future SSE endpoints would reuse this. *Preferred.*
2. **Bypass the router for this one route.** Simpler, but every additional SSE endpoint in the future repeats the boilerplate.

We go with (1). The handler signature becomes:

```ts
streamPublicOverlay = (req: Request, res: Response): void => {
    // 1. parse sessionId, 404 if not found
    // 2. send initial snapshot frame
    // 3. const unsubscribe = bus.subscribe(sessionId, frame => write(res, frame));
    // 4. req.on('close', unsubscribe);
    // 5. if session.endedAt → send one frame + res.end()
};
```

Heartbeat: write a `:\n\n` comment every 25s so intermediary proxies don't terminate idle connections. (Same trick used by typical Node SSE examples.)

### Match-minute extraction and MM:SS formatting

The live snapshot includes `state` (e.g. `{ id, state, name, short_name }`) and `periods` (e.g. `[{ id, type_id, ticking, sort_order, ... }]` with a current-period `minutes` field). Today, [`OverlayPage`](../../frontend/src/Components/overlay/OverlayPage.tsx) only reads `state.short_name`. The new `MatchTimer` consumes both.

A small helper, `frontend/src/common/matchTimer.ts`:

```ts
export type TimerMode =
    | { kind: "running"; referenceMinute: number; referenceWallTime: number }
    | { kind: "kickoff"; startsAt: string }
    | { kind: "state"; label: string };

export function computeTimerMode(fixture: FixtureModel, serverTime: number): TimerMode { ... }

/** MM:SS, ticking smoothly with drift-bound resync (see §3). */
export function formatRunningClock(
    mode: Extract<TimerMode, { kind: "running" }>,
    now: number,
): string { ... }
```

Direct unit tests:

- `computeTimerMode` branches: `NS` → kickoff, `1H`/`2H`/`ET1`/`ET2`/`INPLAY` → running, `HT`/`BREAK` → state, `FT`/`AET`/`FT_PEN` → state, unknown → state-fallback.
- `formatRunningClock` formatting: `(minute=0, wallDelta=0)` → `0:00`, `(minute=47, wallDelta=32_000)` → `47:32`, `(minute=89, wallDelta=120_000)` → `91:00`, plus zero-pad seconds (`(minute=5, wallDelta=3_000)` → `5:03`).
- Re-sync threshold: simulating the bus passing minute hints that differ from local extrapolation by 0, 1, 2 minutes — verify smooth-vs-snap behaviour matches §3.

`MatchTimer` is a tiny presentation component: takes `TimerMode` + a `now` from a `useInterval(1000)` and renders a string. Pure function of its props for testability.

### Frontend SSE subscription

`OverlayRequestClient`:

```ts
subscribeStream(sessionId: number, onMessage: (payload: OverlayPayload) => void, onClose: () => void): EventSource {
    const url = `${this.baseUrl}/public/sessions/${sessionId}/overlay/stream`;
    const es = new EventSource(url);
    es.onmessage = ev => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ } };
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) onClose(); };
    return es;
}
```

`OverlayPage` replaces the polling `useEffect` with one `useEffect` that opens the EventSource, sets `data` on each frame, and closes the source on unmount. The transparent-bg `useEffect` stays untouched.

### Edge cases / decisions baked in

- **`SPORTMONKS_ENABLED=false`.** The bus is constructed unconditionally, but `Bootstrap` only wires the `onTickFinished` callback when the poller exists. Initial-snapshot frames still go out (with empty `fixtures`, all ids in `missingFixtureIds`) — same graceful-degrade pattern as today.
- **No active overlays for a session.** The broadcaster iterates `subscribers.keys()` — empty map means zero per-tick work.
- **Many overlay viewers on the same session.** Each viewer is its own writer in the `Set<writer>`, all receiving the same payload object. The bus reuses the payload reference across writers — no per-viewer JSON serialization, just one `JSON.stringify` per tick in the writer helper.
- **Session ended mid-stream.** Backend emits one final frame with `endedAt: <date>`, then calls `res.end()` so the client sees `EventSource.CLOSED` rather than an infinite reconnect storm. Client renders nothing new — the last known snapshot stays on screen.
- **Reconnect / `Last-Event-ID`.** Out of scope for v1: each connect just re-sends the current snapshot. We can layer on event IDs if missed-event replay ever becomes necessary.
- **Cross-user.** No change — the public endpoint is still capability-by-URL. SSE adds no new auth surface.
- **Backpressure / slow client.** If a writer throws (socket closed, write returns false), the bus removes it immediately — we never queue frames waiting for a dead consumer.
- **Server clock skew.** Each SSE frame includes `serverTime: Date.now()`. The client computes `skew = clientNow - serverTime` once on first frame and uses it to project the authoritative minute forward. Subsequent frames re-compute skew to track NTP correction without snapping.

### Future work (not in this ADR)

- Diff-based broadcast if the per-tick payload bandwidth ever becomes a concern.
- `Last-Event-ID` replay for unreliable connections.
- **Overlay link authentication & single-device binding.** Discussed but deferred: tokenize the overlay URL (`/overlay/{uuid}` instead of `/overlay/{sessionId}`) and bind it to the first device that loads it (signed cookie), with a host-controlled "regenerate link" action. Orthogonal to transport — the SSE channel from this ADR is unaffected. Likely a future ADR 0007.
- Multiple timer styles per host preference (mm:ss running clock vs minute-only).
- Per-fixture events stream (goal cards, substitutions) — would extend the same SSE channel with additional event types.

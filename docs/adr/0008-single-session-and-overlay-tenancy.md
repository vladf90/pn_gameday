# ADR 0008 — Single-Tenant Overlay per Watchalong Session

- **Status:** Proposed
- **Date:** 2026-05-26
- **Author:** Vlad Foamete
- **Builds on:** [ADR 0005](0005-watchalong-sessions.md), [ADR 0006](0006-overlay-live-updates-and-timer.md)

## Context

The OBS Browser Source overlay introduced in [ADR 0005 §4](0005-watchalong-sessions.md) is **public-by-knowledge**: the URL is bare `/overlay/:sessionId`, the session id is a small enumerable integer, and the route has no auth. ADR 0005 itself called out "signed/tokenized overlay URLs" as future work. Two concrete problems have grown out of that decision:

1. **No leak protection.** A host who pastes the URL into Slack, screen-shares it during a stand-up, or leaves it in the browser history of a shared machine has no way to invalidate it. Anyone who learns the URL can render the overlay until the session ends.
2. **No tenancy.** [`OverlayEventBus`](../../backend/src/sportmonks/OverlayEventBus.ts) allows any number of subscribers per session id. Two OBS Browser Sources pointing at the same URL each get a fan-out copy of every frame. There is no "this overlay is in use" signal — they silently coexist.

This ADR is **scoped to the overlay alone**. Login / JWT mechanics are out of scope; users keep their current stateless multi-device behaviour. Watchalong session creation is also out of scope — a user can create as many sessions as they want, the constraint added here is one overlay viewer *per session*.

## Decision

### 1. Per-session opaque overlay token

Add `overlay_token` to `session`: `varchar(64)`, `NOT NULL`, `UNIQUE`. Value is `crypto.randomBytes(32).toString("hex")` — 256 bits of entropy, no PII, no ordering signal.

- **Auto-minted at session create.** [`SessionRepository.create`](../../backend/src/database/repositories/SessionRepository.ts) generates the token and stamps it in the same INSERT.
- **Rotation on demand.** New endpoint `POST /sessions/:id/overlay/token/rotate` (owner-scoped) overwrites with a fresh value and returns the new overlay URL. Frontend surfaces a "Rotate overlay URL" button on [`SessionDetail`](../../frontend/src/Components/sessions/SessionDetail.tsx).
- **No rotation history / audit log.** Overwrite-in-place; previous tokens become invalid immediately.

The public overlay URL becomes:

```
{PUBLIC_OVERLAY_BASE_URL}/overlay/{sessionId}?token={overlayToken}
```

[`SessionSummary.overlayUrl`](../../backend/src/controller/SessionController.ts) already comes from the backend ([SessionController.ts:384-389](../../backend/src/controller/SessionController.ts#L384-L389)) — we extend the construction to include `?token=`. Frontend has no URL-building logic to keep in sync.

Backend validates the token on both public overlay routes:

- `GET /public/sessions/:id/overlay` (one-shot HTTP)
- `GET /public/sessions/:id/overlay/stream` (SSE)

Mismatch or missing token → **404 Session not found**, not 401. Matches the cross-user 404 policy from ADR 0005 — don't leak existence.

### 2. One SSE subscriber per session, last-write-wins

[`OverlayEventBus`](../../backend/src/sportmonks/OverlayEventBus.ts) currently registers an arbitrary list of writers per session id. We tighten that to **one writer at a time**. When `subscribe(sessionId, writeFrame)` is called and a previous writer exists:

1. Invoke the previous writer once with a synthetic terminal payload (`endedAt: new Date(0)` is enough — the existing writer logic at [SessionController.ts:201-215](../../backend/src/controller/SessionController.ts#L201-L215) closes the response when `endedAt !== null`).
2. Replace the slot with the new writer.

The displaced OBS Browser Source / browser tab gets a clean SSE close. Per [ADR 0006 §4](0006-overlay-live-updates-and-timer.md), it shows whatever final frame was last delivered — no "you were kicked" overlay text. The host using OBS *reloads* (and the new connection is the canonical case): the new SSE displaces the stale one rather than running in parallel.

`unsubscribe()` only clears the slot if it's still the same writer (a later subscriber may have already taken it). Otherwise it's a no-op.

### 3. Migration

`AddSessionOverlayToken<ts>`:

`up()`:

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — used for the backfill.
2. `ALTER TABLE "session" ADD COLUMN "overlay_token" varchar(64) NULL;`
3. `UPDATE "session" SET "overlay_token" = encode(gen_random_bytes(32), 'hex') WHERE "overlay_token" IS NULL;` — backfill every existing row.
4. `ALTER TABLE "session" ALTER COLUMN "overlay_token" SET NOT NULL;`
5. `CREATE UNIQUE INDEX "UQ_session_overlay_token" ON "session" ("overlay_token");`

`down()`: drop the unique index, drop the column. (Leave `pgcrypto` enabled.)

### 4. Out of scope

- **Login / JWT changes.** Stateless multi-device login stays exactly as it is today.
- **Watchalong session creation limits.** A user can still create any number of sessions.
- **Per-user overlay viewer cap.** The rule is one viewer per *session*; two sessions = two concurrent overlays is fine.
- **Active-push revocation channel** to tell a displaced OBS "you were kicked." The synthetic terminal frame is enough — the SSE closes naturally on the receiving end.
- **Rotation audit log / history.** Overwrite-in-place; no `overlay_token_history` table.
- **Refresh tokens / TTL changes** of any kind.

### Rejected alternatives

- **HMAC-signed overlay URL (stateless).** Tempting — no DB column, signature verifies on its own. But it can't be *rotated* without changing the signing key (which would invalidate every overlay URL at once). A per-row random token can be overwritten in one UPDATE without affecting other sessions.
- **Cookie-based overlay auth.** OBS Browser Source doesn't share cookies with the host's logged-in browser the way a real client does; the query-string token is the simplest thing that works for OBS.
- **Block second SSE viewer (first-wins) instead of last-write-wins.** Worse UX — when OBS reloads the Browser Source (very common), the new connection would be rejected because the old one hasn't closed yet on the server. Last-write-wins is what the host actually expects.
- **Separate "overlay viewer registry" data structure outside `OverlayEventBus`.** Considered for §2 — rejected. The bus is already the per-session subscriber registry; adding another tracking surface duplicates state. The eviction lives in `subscribe`.
- **Token in URL fragment (`#token=…`) instead of query string.** Fragments are client-only and never sent to the server, so they can't be used for server-side validation. We need a value the server sees.
- **Tying the overlay token to the host's login session** (so logout invalidates the overlay). Out of scope — login mechanics aren't being touched here.

## Technical Approach

### Files

```
backend/src/
├── controller/SessionController.ts                        # validate overlay token on public routes;
│                                                          # new rotateOverlayToken handler
├── database/
│   ├── entities/Session.ts                                # add overlayToken column
│   ├── migrations/
│   │   └── <ts>-AddSessionOverlayToken.ts                 # NEW
│   └── repositories/SessionRepository.ts                  # generate token on create;
│                                                          # rotateOverlayToken; findByIdAndToken
├── sportmonks/
│   └── OverlayEventBus.ts                                 # subscribe() evicts prior subscriber
└── Bootstrap.ts                                           # mount POST /sessions/:id/overlay/token/rotate

frontend/src/
├── clients/
│   ├── SessionRequestClient.ts                            # rotateOverlayToken() call
│   └── OverlayRequestClient.ts                            # append ?token= to overlay/stream URLs
├── Components/
│   ├── sessions/SessionDetail.tsx                         # "Rotate overlay URL" button + confirm modal
│   └── overlay/OverlayPage.tsx                            # read token from query string, pass to client

docs/adr/
└── 0008-single-session-and-overlay-tenancy.md             # this file
```

No `.env.example` change.

### Token generation

```ts
// backend/src/database/repositories/SessionRepository.ts
import { randomBytes } from "crypto";

function generateOverlayToken(): string {
    return randomBytes(32).toString("hex");
}
```

Same function used at create-time and at rotation-time. We don't worry about uniqueness collisions — 256 bits of entropy makes the birthday-bound astronomical, and the unique index would surface a collision as a constraint violation anyway (retryable, but it will never happen).

### Overlay-token validation

[`SessionController.publicOverlay`](../../backend/src/controller/SessionController.ts) and `streamPublicOverlay` both delegate to `buildOverlayPayload(sessionId)` today. Change to `buildOverlayPayload(sessionId, token)`:

```ts
private async buildOverlayPayload(sessionId: number, token: string | undefined): Promise<PublicOverlayResponse | null> {
    if (!token) return null;
    const session = await this.sessionRepository.findByIdAndToken(sessionId, token);
    if (!session) return null;
    // … existing fixture-snapshot path
}
```

Callers surface `null` → 404 either via the BaseRouter wrapper (HTTP) or the inline `ServiceError.build` path before headers flush (SSE).

`streamPublicOverlay` already validates `req.params.id` inline; we add an analogous read of `req.query.token` (as a string).

The broadcast path in `broadcastOverlayUpdates` calls `buildOverlayPayload(sessionId)` per subscribed session. We give that path a server-internal overload that skips token validation (we already know the subscription was authorised at `subscribe` time):

```ts
// for the broadcast loop only — token already checked when the subscriber was registered
private async buildOverlayPayloadTrusted(sessionId: number): Promise<PublicOverlayResponse | null> { … }
```

### OverlayEventBus shape change

```ts
// before: writers stored as a Set<WriteFrame>
// after:  writers stored as Map<sessionId, WriteFrame> (one slot per session)

subscribe(sessionId: number, writer: WriteFrame): () => void {
    const prior = this.writers.get(sessionId);
    if (prior) {
        // synthetic terminal frame — writer closes the response itself
        prior({ sessionId, name: "", endedAt: new Date(0), fixtures: [], missingFixtureIds: [], serverTime: Date.now() });
    }
    this.writers.set(sessionId, writer);
    return () => {
        if (this.writers.get(sessionId) === writer) {
            this.writers.delete(sessionId);
        }
    };
}
```

`broadcast(sessionId, payload)` becomes a one-element dispatch instead of a fan-out. `subscribedSessionIds()` is unchanged in behaviour (still returns the keys of the writer map).

### Frontend changes

- [`OverlayPage`](../../frontend/src/Components/overlay/OverlayPage.tsx) reads `?token=…` from the URL via `useSearchParams` (already a React Router idiom in use elsewhere) and passes it through `OverlayRequestClient.subscribeStream(sessionId, token, callbacks)`.
- [`OverlayRequestClient`](../../frontend/src/clients/OverlayRequestClient.ts) appends `?token=` to both the one-shot and SSE URLs. If token is missing → don't even open the SSE; show the "Invalid overlay link" error path.
- [`SessionDetail`](../../frontend/src/Components/sessions/SessionDetail.tsx) adds a "Rotate overlay URL" button next to the existing copy-URL affordance:
  - Click → confirm modal: *"This will invalidate the current OBS Browser Source. Paste the new URL into OBS after rotating."*
  - On confirm → `POST /sessions/:id/overlay/token/rotate` → update local `session.overlayUrl` state in place.

### Edge cases / decisions baked in

- **Existing sessions at deploy time.** The migration backfills tokens for every row, so no session breaks. Hosts whose OBS is using the *old* tokenless URL get a 404 on next request and must paste the new URL in.
- **Token leakage via `Referer`.** Putting the token in the query string means a `Referer` header *could* leak it if the overlay rendered external links. It renders none, so this is moot today. If we ever embed external links in the overlay, we move the token to a header (requires a small JS shim since `EventSource` can't set headers — at that point switching to `fetch` + ReadableStream is the migration).
- **Rotation while OBS is connected.** Rotating the token mid-stream does *not* tear down the existing SSE — that connection was authorised at subscribe time and stays valid until the OBS source reloads. On reload, the old URL 404s; the host pastes the new URL in. Matches "revocation is lazy" — we don't crawl active subscribers on rotation.
- **Cross-user attempted rotation.** Same owner-scope filter as every other session route — non-owner gets 404 (ADR 0005 don't-leak-existence policy).
- **`SPORTMONKS_ENABLED=false`.** Unchanged: overlay routes still mount, fixtures all surface as missing. Token validation runs first regardless.
- **Concurrent SSE reconnects.** Three OBS instances opening the same URL within ms of each other: each subscribe call evicts whoever was last in the slot. The winner is whichever subscribe call ran last. Eviction frames go to the losers cleanly. No locks needed — JavaScript single-threaded execution means `subscribe` calls serialise on the event loop.
- **Synthetic terminal frame `endedAt: new Date(0)`.** Per ADR 0006 §4 the frontend doesn't render "session ended" text — it just freezes on the last good frame. The displaced OBS shows whatever it had, then the SSE closes. Acceptable.
- **Empty token in the query string (`?token=`).** Treated as missing → 404. We don't distinguish empty-string from omitted.

### Future work (not in this ADR)

- HMAC-signed overlay tokens with finite TTL (would let shared links expire automatically without explicit rotation).
- Token rotation audit log / history table.
- Per-user overlay viewer cap (one OBS instance total across all of the user's sessions).
- "Detach overlay" affordance on session detail — sever any active overlay subscriber from the dashboard without rotating the token.
- Migration of the overlay query-string token to a header / fragment if external links ever appear inside the overlay.

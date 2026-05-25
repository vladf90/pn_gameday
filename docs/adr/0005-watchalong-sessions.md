# ADR 0005 — Watchalong Sessions: Ownership, Lifecycle, and OBS Overlay

- **Status:** Proposed
- **Date:** 2026-05-25
- **Author:** Vlad Foamete
- **Builds on:** [ADR 0001](0001-sportmonks-integration.md), [ADR 0004](0004-db-seeds-and-auth-gated-fixtures-view.md)

## Context

A host wants to run a "watchalong": create a **session**, attach the **fixtures** they'll be commentating on, and get a **URL they paste into OBS as a Browser Source** so live scores render on-stream. The skeleton already exists — [`Session`](../../backend/src/database/entities/Session.ts) + [`session_fixture`](../../backend/src/database/entities/SessionFixture.ts), full CRUD via [`SessionController`](../../backend/src/controller/SessionController.ts), and the [`FixturePoller`](../../backend/src/sportmonks/FixturePoller.ts) → [`LiveSnapshotStore`](../../backend/src/sportmonks/LiveSnapshotStore.ts) pipeline that already supplies the data the overlay will render. Three concrete gaps stop it from being a feature:

1. **No ownership.** Every authenticated user currently sees every session. A list of "my sessions" doesn't exist.
2. **No lifecycle.** There's no notion of an "ended" session, so a naive "list sessions" query has to scan the whole table forever. The host explicitly flagged this scaling concern.
3. **No overlay.** Nothing in the codebase mentions OBS, RTMP, HLS, or any kind of public stream URL — the host has no way to get a renderable link.

Bundled into one ADR because they hang off the same `session` row and the same boot path.

## Decision

### 1. Ownership: per-user, controller-enforced

Add `user_id` FK to `session`. Every CRUD path in [`SessionController`](../../backend/src/controller/SessionController.ts) filters by `auth.id`; cross-user requests return **404, not 403**, to avoid leaking session existence. `create` stamps `userId = auth.id`. No new permission strings — existing `session:*` covers it; ownership is enforced in the controller layer, not RBAC.

### 2. Lifecycle: `ended_at` + auto-end + manual force-end

A session has a single nullable `ended_at` timestamp. `NULL` = active; non-null = ended.

- **Auto-end** by a periodic `SessionAutoCloser` service: a session is ended when it has ≥1 attached fixture **and** every fixture's `LiveSnapshotStore` snapshot is in a terminal SportMonks state (`FT`, `AET`, `FT_PEN`, `CANCL`, `POSTP`, `ABAN`, `AWARDED`, `WO`). **Missing snapshots block auto-end** — we never guess. Runs on its own `setTimeout` loop at `SESSION_AUTOCLOSE_INTERVAL_MS` (default 30s), decoupled from the 5s poll cadence because auto-close doesn't need sub-poll latency.
- **Manual force-end:** `POST /sessions/:id/end`. Idempotent at the SQL layer (`UPDATE … WHERE ended_at IS NULL`); second call returns 409.

### 3. Cheap "active sessions" listing: partial index

```sql
CREATE INDEX "IDX_session_user_active"
  ON "session" ("user_id")
  WHERE "ended_at" IS NULL;
```

This is the index that makes `GET /sessions` O(active) regardless of how big the ended-sessions tail grows — directly addressing the host's "won't scale" concern. `GET /sessions` defaults to `status=active`; `?status=ended` and `?status=all` exist as overrides.

### 4. OBS overlay: public read endpoint + frontend overlay page

OBS Browser Source has no auth header. So:

- **Backend:** new **unauthenticated** `GET /public/sessions/:id/overlay` on [`NoAuthRouter`](../../backend/src/router/NoAuthRouter.ts) returning `{ sessionId, name, endedAt, fixtures: LiveFixture[], missingFixtureIds: number[] }`. Reuses the same `LiveSnapshotStore.getMany` read path as the existing authenticated `getLive`.
- **Frontend:** public `/overlay/:sessionId` route outside `<Authenticated>`, polling every ~5s, rendering scoreboards on a transparent background (`body { background: transparent }`) for OBS chroma-style compositing.
- **URL form:** plain `/overlay/:id`. Sessions IDs are enumerable; the data is SportMonks score data — acceptable for v1. If enumeration becomes a real concern, a follow-up adds `overlay_token UUID UNIQUE` and switches the public endpoint to lookup-by-token.

### Rejected alternatives

- **Signed/tokenized overlay URLs from day one.** Premature — the data is public-ish, and a future migration can swap in `overlay_token` without changing the controller shape much.
- **Status enum (`active|ended|cancelled|…`) instead of `ended_at`.** A nullable timestamp encodes both *whether* and *when* the session ended in one column, and the partial-index pattern is more idiomatic in Postgres against `IS NULL` than against an enum equality.
- **Auto-end at the FixturePoller boundary** (end inside the poll tick when a fixture flips to terminal). Tighter coupling, worse separation of concerns, harder to test. A separate periodic closer is simpler and the 30s extra latency doesn't matter for "session has ended."
- **TTL safety-net cron** (auto-end any session inactive >24h). Out of scope — the user's primary mechanism is "all fixtures finished," and a TTL is a band-aid for a different failure mode (host forgets to attach fixtures). Easy to add later.
- **Streaming infrastructure (RTMP/HLS ingest).** The host explicitly chose "browser-source overlay" — we do **not** host or relay video. The overlay renders scores on top of whatever video the host is already capturing in OBS.
- **Admin override on session listing.** Punt; controller is owner-only. Easy to add a `?asUser=` query with an `admin` role check later.

## Technical Approach

### Files

```
backend/src/
├── Bootstrap.ts                                          # register POST /sessions/:id/end +
│                                                        # GET /public/sessions/:id/overlay;
│                                                        # construct/start/stop SessionAutoCloser
├── controller/SessionController.ts                      # owner-scope all handlers; add end + publicOverlay;
│                                                        # expose endedAt + overlayUrl in responses
├── database/
│   ├── entities/Session.ts                              # add userId, user, endedAt
│   ├── migrations/
│   │   └── <ts>-AddSessionOwnershipAndLifecycle.ts      # NEW
│   └── repositories/SessionRepository.ts                # owner-scoped queries, markEnded, findActiveWithFixtureIds
├── sportmonks/
│   ├── isFixtureFinished.ts                             # NEW — terminal-state predicate (+ unit test)
│   └── SessionAutoCloser.ts                             # NEW — periodic auto-end service
frontend/src/
├── clients/SessionRequestClient.ts                      # NEW
├── Components/sessions/SessionsList.tsx                 # NEW — active by default + "show ended" toggle
├── Components/sessions/SessionDetail.tsx                # NEW — copyable overlay URL, attach via FixturesByDate
├── Components/overlay/OverlayPage.tsx                   # NEW — public, transparent bg, ~5s polling
└── App.tsx                                              # /sessions, /sessions/:id, public /overlay/:id
docs/adr/
└── 0005-watchalong-sessions.md                          # this file
.env.example                                             # SESSION_AUTOCLOSE_INTERVAL_MS, PUBLIC_OVERLAY_BASE_URL
```

### Migration shape — `AddSessionOwnershipAndLifecycle<ts>`

`up()`:

1. `ALTER TABLE "session" ADD COLUMN "user_id" integer NULL;`
2. Backfill — in dev we expect zero or near-zero existing rows; the migration documents both options (`DELETE FROM "session"` or `UPDATE … SET user_id = <admin>`) and the implementation issue will pick one based on the host's actual dev DB state.
3. `ALTER COLUMN "user_id" SET NOT NULL;`
4. `ADD CONSTRAINT "FK_session_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;`
5. `ADD COLUMN "ended_at" TIMESTAMP NULL;`
6. `CREATE INDEX "IDX_session_user_active" ON "session" ("user_id") WHERE "ended_at" IS NULL;`

`down()`: drop the index, drop `ended_at`, drop the FK, drop `user_id`.

### Terminal-state detection

`backend/src/sportmonks/isFixtureFinished.ts`:

```typescript
const TERMINAL_STATE_SHORT_NAMES = new Set([
    "FT", "AET", "FT_PEN", "CANCL", "POSTP", "ABAN", "AWARDED", "WO",
]);
export function isFixtureFinished(fx: LiveFixture): boolean {
    const state = fx.state as { short_name?: unknown } | undefined;
    return typeof state?.short_name === "string"
        && TERMINAL_STATE_SHORT_NAMES.has(state.short_name);
}
```

[`LiveFixture.state`](../../backend/src/sportmonks/types/LiveFixture.ts) is typed as `unknown`, so the helper parses defensively. Direct unit tests over the terminal/non-terminal short names (`FT`, `HT`, `NS`, `POSTP`, etc.) plus malformed input (missing field, non-string).

### SessionAutoCloser shape

```typescript
class SessionAutoCloser {
    constructor(
        private repo: SessionRepository,
        private store: LiveSnapshotStore,
        private intervalMs: number,
    ) {}
    async start(): Promise<void> { /* setTimeout-driven recursive tick, like FixturePoller */ }
    async stop(): Promise<void>  { /* drain in-flight tick, mirror FixturePoller pattern */ }
    private async runTick(): Promise<void> {
        const active = await this.repo.findActiveWithFixtureIds();
        for (const { sessionId, userId, fixtureIds } of active) {
            if (fixtureIds.length === 0) continue;
            const snaps = this.store.getMany(fixtureIds);
            if (snaps.length !== fixtureIds.length) continue;     // missing snapshot → don't guess
            if (snaps.every(isFixtureFinished)) {
                await this.repo.markEnded(sessionId, userId);
            }
        }
    }
}
```

Constructed only when `SPORTMONKS_ENABLED=true` and `liveSnapshotStore` exists (mirroring [`Bootstrap.configureSportmonks`](../../backend/src/Bootstrap.ts) and the existing optional-snapshot-store pattern). Started after the poller; stopped in the SIGTERM handler next to `fixturePoller?.stop()`.

### Routes added in `Bootstrap.ts`

```ts
authRouter.post("/sessions/:id/end", controller.end, new EndSessionValidator(),
    { resource: 'session', action: 'update' });
noAuthRouter.get("/public/sessions/:id/overlay", controller.publicOverlay);
```

Existing 8 session routes keep their signatures — only the controller bodies change to filter by `auth.id`.

### Edge cases / decisions baked in

- **Session with zero fixtures.** Never auto-ends. The host must either attach fixtures (then auto-end works) or manually end. Matches expected UX — empty sessions are "in setup."
- **Mixed finished + in-play fixtures.** Session stays active. Auto-end only fires when *every* attached fixture is terminal.
- **Fixture not yet polled / not in snapshot store.** Treated as "state unknown" — blocks auto-end. The poller's normal cadence (5s) will fill the snapshot within seconds for any in-range fixture.
- **`SPORTMONKS_ENABLED=false`.** `SessionAutoCloser` is not constructed; `publicOverlay` still mounts but reports every fixture as missing — same graceful-degrade pattern as the existing `getLive` (see [SessionController.ts:58-62](../../backend/src/controller/SessionController.ts#L58-L62)).
- **`overlayUrl` construction.** Read `PUBLIC_OVERLAY_BASE_URL` from env in the controller (e.g. `http://localhost:5173` in dev). `${PUBLIC_OVERLAY_BASE_URL}/overlay/${session.id}`. If the env var is missing, omit the field rather than emitting a malformed URL — the frontend can fall back to computing it from `window.location.origin` for the in-app "copy" button.
- **Concurrency on manual end.** Two simultaneous `POST /:id/end` calls — only the first flips `ended_at` (guarded by `WHERE ended_at IS NULL`). The second observes 0 rows updated → 409. No locks needed.
- **Cross-user 404 vs 403.** Returning 404 on someone else's session keeps URLs un-probeable. Matches the principle that an unauthenticated user wouldn't be able to distinguish "doesn't exist" from "not yours" either.
- **Existing dev DBs.** The new migration adds a NOT NULL column to a table that may already have rows. The implementation issue will document the dev procedure (`DELETE FROM session` or backfill `user_id = <admin>`).

### Future work (not in this ADR)

- Signed/tokenized overlay URLs (`overlay_token UUID UNIQUE` + lookup by token on the public endpoint).
- Admin role override on session listing.
- TTL safety-net auto-end for "host forgot to attach fixtures" cases.
- Multi-fixture scoreboard layout customization (overlay component is v1 simple list).
- Per-fixture overlay sub-URLs for hosts who want to switch scoreboards mid-stream.
- Migration to multi-org / shared sessions (would require relaxing the controller-side owner filter).

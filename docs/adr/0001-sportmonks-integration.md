# ADR 0001 — SportMonks API Integration with Per-Entity Quota Monitoring

- **Status:** Accepted
- **Date:** 2026-05-22
- **Author:** Vlad Foamete

## Context

`pn_gameday` needs live sports event data (in-play fixtures, events, stats) for a small, curated set of fixtures grouped into **sessions**. A session pins a list of fixtures the application cares about; the backend must keep those fixtures' live state fresh.

The chosen provider is [SportMonks](https://docs.sportmonks.com/). SportMonks bills on a per-entity, per-hour quota model — each entity type (`Fixture`, `Team`, `Player`, `League`, `Season`, `Type`) has its own independent hourly bucket. The starter plan we begin with allows **2,000 calls / hour / entity**, growing to 5,000 on Enterprise. Every response carries a `rate_limit` block (`remaining`, `requested_entity`, `resets_in_seconds`).

Because we only care about the fixtures attached to active sessions — not every match SportMonks knows about — the integration must:

1. Poll only the fixtures the application actually needs (batched, not "all in-play").
2. Avoid any redundant calls; lookups for slow-changing reference data must not consume runtime quota.
3. Expose per-entity consumption as Prometheus metrics so we can react before throttling.
4. Stay tier-portable — same code keeps working as plans are upgraded.

The backend currently has no third-party API integrations, no scheduler, no metrics surface, and no `session` entity.

## Decision

Build a self-contained `sportmonks` module inside `backend/src/` that:

- Wraps SportMonks via a typed HTTP client with retry, `429` backoff, and parsing of the `rate_limit` block on every response.
- Polls `/fixtures/multi/{ids}` on a **fixed 5-second interval**, where `{ids}` is the union of fixture IDs across all sessions (deduplicated). One call per tick, regardless of how many sessions / fixtures exist (up to SportMonks' multi-ID limit, ~50; if exceeded we issue multiple calls per tick).
- Includes `scores;state;events;participants;statistics` so a single call covers the data the UI needs.
- Holds the latest response per fixture in an **in-memory store** — nothing from SportMonks is persisted to Postgres.
- Source of fixture IDs is abstracted behind a `FixtureSelectionProvider` interface. The v1 implementation reads from new `session` + `session_fixture` tables; later iterations can plug in alternate providers without touching the poller.
- Exposes per-entity quota state through `prom-client` at `GET /metrics`, ready for Grafana scraping and alerting.

### Rejected alternatives

- **`/livescores/inplay` polling.** Returns every in-play match in our subscription, including ones we don't care about, and silently ignores selected fixtures that aren't in-play yet. `/fixtures/multi/{ids}` is more precise at the same per-tick cost.
- **Webhooks.** Cleaner cost profile, but requires a public endpoint with signature verification. Deferred to a later iteration.
- **Mirroring SportMonks reference data into Postgres (leagues, teams, players, seasons, types).** Initially planned, removed at the user's request — we pass through whatever the `/fixtures/multi` `includes` block returns and let the frontend render it directly. Revisit if a non-fixture lookup path appears.
- **Adaptive polling intervals.** Considered (long interval when no tracked fixture is live), dropped because fixed 5 s is well within the Starter quota (~720/hr vs 2 000/hr) and the simpler model is easier to reason about.
- **A separate worker process for polling.** Lives in the API process for v1; can be split out later without changing module contracts.
- **Custom metrics stack (StatsD, OTel).** Prometheus + Grafana is the chosen observability stack; `prom-client` is one dependency.

## Technical Approach

### Module layout

```
backend/src/sportmonks/
├── SportmonksClient.ts          # Typed HTTP wrapper, retry/backoff, response unwrapping
├── RateLimitTracker.ts          # Per-entity remaining/reset state
├── metrics.ts                   # prom-client registry, counters & gauges
├── FixturePoller.ts             # Fixed-interval loop calling /fixtures/multi/{ids}
├── LiveSnapshotStore.ts         # In-memory Map<fixtureId, LiveFixture>
├── FixtureSelectionProvider.ts  # Interface — getActiveFixtureIds(): Promise<number[]>
├── SessionFixtureProvider.ts    # Default impl, reads from session_fixture
├── types/                       # SportMonks DTOs (subset we consume)
└── index.ts                     # Bootstrap: starts poller, registers metrics
```

### Configuration (`.env`)

| Var | Default | Purpose |
| --- | --- | --- |
| `SPORTMONKS_API_TOKEN` | *(required)* | API token, never logged. |
| `SPORTMONKS_BASE_URL` | `https://api.sportmonks.com/v3/football` | Allows sport / staging override. |
| `SPORTMONKS_PLAN_HOURLY_LIMIT` | `2000` | Used for metric/alert thresholds; SportMonks enforces the actual limit. |
| `SPORTMONKS_POLL_INTERVAL_MS` | `5000` | Fixed polling cadence. |
| `SPORTMONKS_MULTI_FIXTURE_BATCH_SIZE` | `50` | Max IDs per `/fixtures/multi` call; tick issues N/B calls when the active set exceeds this. |
| `SPORTMONKS_ENABLED` | `true` | Kill-switch for local dev / CI. |

### Persistence (Postgres)

Only **two new tables**, both owned entirely by us — no SportMonks data is mirrored.

- `session`
  - `id` (pk, generated)
  - `name` (varchar)
  - `created_at`, `updated_at`
- `session_fixture`
  - `session_id` (fk → `session.id`, on delete cascade)
  - `sportmonks_fixture_id` (bigint — the upstream ID, no fk into our DB)
  - `created_at`
  - **Composite PK** `(session_id, sportmonks_fixture_id)`
  - Index on `sportmonks_fixture_id` for the poller's union query.

One migration creates both tables. CRUD endpoints for `session` follow the REST convention (see `backend/CLAUDE.md`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/:id` | Fetch a session |
| `POST` | `/sessions` | Create a session |
| `PATCH` | `/sessions/:id` | Update a session |
| `DELETE` | `/sessions/:id` | Delete a session (cascades to `session_fixture`) |
| `POST` | `/sessions/:id/fixtures` | Attach a fixture (body: `{ sportmonksFixtureId }`) |
| `DELETE` | `/sessions/:id/fixtures/:fixtureId` | Detach a fixture |
| `GET` | `/sessions/:id/live` | Snapshot of live state for this session's fixtures (no SportMonks call) |

**Prerequisite:** `BaseRouter` currently only exposes `get()` and `post()`. Adding `patch()` and `delete()` (and updating `IRouter`) is a precondition issue for this feature.

The `session` shape here is intentionally minimal — only what the poller needs to function end-to-end. Richer session metadata (owner, status, scheduled window, etc.) is a separate feature.

### Live snapshot (in-memory)

`LiveSnapshotStore` keeps the latest poll result keyed by `fixtureId`. Exposes:

- `getAll(): LiveFixture[]`
- `get(fixtureId): LiveFixture | undefined`
- `getMany(fixtureIds): LiveFixture[]`
- `replaceMany(fixtures: LiveFixture[])` — called by poller after each successful fetch
- `evictMissing(activeFixtureIds: number[])` — drops entries for fixtures no longer in any session

No persistence. Lost on restart, repopulated on the next poll tick.

A read endpoint `GET /sessions/:id/live` returns the snapshot subset for that session (joining `session_fixture` → snapshot, no SportMonks call).

### Polling loop

`FixturePoller.start()`:

1. Resolve active IDs: `provider.getActiveFixtureIds()` (deduped union across sessions).
2. If empty, schedule next tick and exit (no call made).
3. Chunk into batches of `SPORTMONKS_MULTI_FIXTURE_BATCH_SIZE`.
4. For each chunk, `GET /fixtures/multi/{ids}?include=scores;state;events;participants;statistics` via `SportmonksClient`.
5. `LiveSnapshotStore.replaceMany(response.data)`.
6. `LiveSnapshotStore.evictMissing(activeIds)`.
7. Schedule next tick after `SPORTMONKS_POLL_INTERVAL_MS`.

Errors are logged + counted (`status="error"`) and never abort the loop. On `HTTP 429`, the client backs off exponentially up to the bucket's `resets_in_seconds`; the loop resumes once the client is ready.

Implemented as `setTimeout` recursion (not `setInterval`) so ticks never overlap. Graceful shutdown on `SIGTERM` drains the in-flight request.

### Metrics (Prometheus)

Exposed at `GET /metrics` (unauthenticated; protect via reverse proxy / firewall in prod).

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `sportmonks_api_calls_total` | counter | `entity`, `endpoint`, `status` | Every outbound call. `status` ∈ {`success`, `error`, `throttled`}. |
| `sportmonks_api_call_duration_seconds` | histogram | `entity`, `endpoint` | Latency. |
| `sportmonks_rate_limit_remaining` | gauge | `entity` | Latest `remaining` reported by SportMonks. |
| `sportmonks_rate_limit_reset_seconds` | gauge | `entity` | Seconds until the bucket resets. |
| `sportmonks_rate_limit_throttled_total` | counter | `entity` | Times we backed off due to 429 / low remaining. |
| `sportmonks_live_fixtures_in_memory` | gauge | — | Size of the live snapshot. |
| `sportmonks_active_fixture_ids` | gauge | — | Size of the deduped active-fixture set. |
| `sportmonks_poller_last_success_timestamp` | gauge | — | Unix seconds of last successful tick. |

Names follow Prometheus conventions (`_total`, `_seconds`). Grafana dashboards and alerts (e.g. `remaining / limit < 0.1`) are produced separately once metrics flow.

### Error handling

- All SportMonks errors map to `ServiceError` with HTTP 502 for handler-triggered calls. Background poller errors are logged via the existing Winston `Logger` and never crash the process — failure increments `sportmonks_api_calls_total{status="error"}` and the next tick proceeds normally.
- The token is never logged. Logs include `entity`, `endpoint`, `status`, `duration_ms`, `remaining`.

### Out of scope (future iterations)

- Frontend UI for sessions, fixture selection, live data display, quota dashboard.
- Richer `session` metadata (owner, status, scheduled window).
- Webhook ingestion as a polling supplement / replacement.
- Multi-sport support (each SportMonks sport is a different API root).
- Persisting any SportMonks data (live fixtures, reference data) to Postgres.
- Grafana dashboards and alert routing.

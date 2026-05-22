# ADR 0002 — Generic SportMonks HTTP Client + Per-Entity Typed Clients

- **Status:** Proposed
- **Date:** 2026-05-22
- **Author:** Vlad Foamete
- **Supersedes (partially):** ADR 0001 § "Module layout" — the `SportmonksClient.ts` description is replaced by what follows.

## Context

ADR 0001 introduced a single `SportmonksClient` that wraps SportMonks v3 via a typed `get<T>(path, query)` call. It owns transport, retry/backoff on `HTTP 429`, response envelope parsing, rate-limit tracking, and metrics. The only current consumer is `FixturePoller`, which calls `/fixtures/multi/{ids}` directly with a raw path string.

We want to grow the integration beyond fixtures (leagues, seasons, standings, etc.). Two problems with the current shape:

1. **Callers must know SportMonks paths and include keys by heart.** A typo in `"/fixtures/multi/..."` or in `include=scores;state;...` only surfaces at runtime. There is no compile-time check that an `include` is valid for the entity being requested.
2. **Retry/backoff inside the generic client is the wrong layer.** Different callers want different policies — the fixture poller already logs+continues on errors and runs again 5 s later, so an in-band retry just inflates per-tick latency without changing the outcome. Future ad-hoc callers (e.g. a UI-triggered fetch) probably want the error surfaced quickly so they can show a state to the user, not a slow retry storm. The retry block at [SportmonksClient.ts:108-148](backend/src/sportmonks/SportmonksClient.ts:108) also masks 429s from the rate-limit dashboards (a retried-then-succeeded 429 still counts once in `_throttled_total`, but the poller's "last success" gauge stays green, so on-call sees no signal).

We considered keeping one client and adding helper functions per entity, but that leaves the typed-method discoverability and per-entity `include` validation problems unsolved.

## Decision

Split the client in two:

- **`SportmonksHttpClient`** (renamed from `SportmonksClient`) — a pure transport. One method, `get<T>(path, query, opts)`. No retry. `HTTP 429` throws like any other non-2xx. Keeps response envelope parsing, rate-limit-block extraction → `RateLimitTracker`, and Prometheus metrics. The `throttled` flag and `SportmonksGetResult` wrapper are removed; the method returns `data` directly.
- **Nine entity clients** (`FixturesClient`, `LivescoresClient`, `LeaguesClient`, `SeasonsClient`, `StatisticsClient`, `StandingsClient`, `TopscorersClient`, `TeamsClient`, `PlayersClient`) — each composes an `SportmonksHttpClient` and exposes one typed method per documented endpoint in [SportMonks v3](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints). Methods accept typed parameters (IDs, dates, an `includes?: EntityInclude[]` where `EntityInclude` is a string-literal union derived from the docs) and return typed DTOs. Each entity client pins its canonical entity label (e.g. `"Fixture"`, `"League"`) and passes it down to the HTTP client so metrics still group correctly.

The existing `FixturePoller` is migrated to call `FixturesClient.getMulti(ids, { includes })` in the same PR sequence.

### Rejected alternatives

- **Keep one client, add `entity` argument.** Doesn't solve discoverability or include-key validation; was effectively the status quo.
- **Keep retry inside the generic client.** The only consumer (the poller) doesn't benefit, and centralised retry hides the 429 signal from metrics consumers. If a future caller wants retry it can wrap the entity client.
- **`string[]` for includes.** No compile-time guard against typos; typed unions are cheap to maintain (one literal type per entity, copied from the docs).
- **Move retry to entity clients.** Same wrong-layer problem at a finer grain. Callers know their own retry policy; clients shouldn't.
- **Generate clients from an OpenAPI spec.** SportMonks doesn't publish a complete machine-readable spec, and hand-rolled typed methods are a one-day job for 9 entities.

## Technical Approach

### Module layout (new)

```
backend/src/sportmonks/
├── clients/
│   ├── SportmonksHttpClient.ts   # renamed from SportmonksClient.ts; pure transport
│   ├── FixturesClient.ts
│   ├── LivescoresClient.ts
│   ├── LeaguesClient.ts
│   ├── SeasonsClient.ts
│   ├── StatisticsClient.ts
│   ├── StandingsClient.ts
│   ├── TopscorersClient.ts
│   ├── TeamsClient.ts
│   └── PlayersClient.ts
├── types/
│   ├── includes.ts               # per-entity include unions
│   ├── Fixture.ts, League.ts, …  # response DTOs (minimal fields; extend as consumers demand)
│   └── …existing files
├── RateLimitTracker.ts           # unchanged
├── metrics.ts                    # unchanged
├── FixturePoller.ts              # migrated to FixturesClient
├── LiveSnapshotStore.ts          # unchanged
├── FixtureSelectionProvider.ts   # unchanged
├── SessionFixtureProvider.ts     # unchanged
└── index.ts                      # re-exports HTTP client + 9 entity clients
```

### `SportmonksHttpClient` shape

```typescript
class SportmonksHttpClient {
    constructor(config: SportmonksHttpClientConfig, rateLimitTracker: RateLimitTracker);

    async get<T>(
        path: string,
        query?: Record<string, string | number>,
        options?: { ctx?: Context; entity: string },
    ): Promise<T>;
}
```

- `entity` becomes required on `get()` — every caller is an entity client that knows its own label.
- Returns `T` directly (the envelope `.data`). The `rateLimit` block is still extracted and pushed into `RateLimitTracker`; callers who need it read from the tracker.
- Removed from config: `initialBackoffMs`, `maxRetries`. Removed methods: `computeBackoffMs`, `parseRetryAfterSeconds`, `sleep`. Removed type: `SportmonksGetResult`. `SportmonksHttpError` is kept and re-exported.

### Entity-client shape

Each method is a thin typed wrapper around `httpClient.get<T>`. Example for fixtures (10 endpoints from the docs):

```typescript
type FixtureInclude =
    | "sport" | "round" | "stage" | "group" | "aggregate" | "league" | "season"
    | "coaches" | "tvStations" | "venue" | "state" | "weatherReport" | "lineups"
    | "events" | "timeline" | "comments" | "trends" | "statistics" | "periods"
    | "participants" | "odds" | "premiumOdds" | "inplayOdds" | "prematchNews"
    | "postmatchNews" | "metadata" | "sidelined" | "predictions" | "referees"
    | "formations" | "ballCoordinates" | "scores" | "xGFixture" | "pressure"
    | "expectedLineups";

interface FixturesQueryOptions { includes?: FixtureInclude[]; ctx?: Context }

class FixturesClient {
    constructor(private readonly http: SportmonksHttpClient) {}

    private readonly entity = "Fixture";

    getAll(opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getById(id: number, opts?: FixturesQueryOptions): Promise<Fixture>;
    getMulti(ids: number[], opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getByDate(date: string, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getByDateRange(start: string, end: string, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getByDateRangeForTeam(start: string, end: string, teamId: number, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getHeadToHead(teamA: number, teamB: number, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    search(name: string, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getUpcomingByMarket(marketId: number, opts?: FixturesQueryOptions): Promise<Fixture[]>;
    getLatest(opts?: FixturesQueryOptions): Promise<Fixture[]>;
}
```

Includes are joined with `;` and passed via the `include` query param — same wire shape as today's poller. DTOs ship as **minimal** types (id + a handful of fields visible in the docs); consumers extend them as needed.

### Endpoint coverage per client

Paths follow SportMonks v3 conventions; the docs list endpoint names, sometimes without the explicit path. Where the path is implicit, the issue body for that client confirms the path against the live SportMonks docs page before implementation lands.

| Client | Endpoints |
| --- | --- |
| `FixturesClient` | `getAll`, `getById`, `getMulti`, `getByDate`, `getByDateRange`, `getByDateRangeForTeam`, `getHeadToHead`, `search`, `getUpcomingByMarket`, `getLatest` |
| `LivescoresClient` | `getAll` (`/livescores`), `getInplay` (`/livescores/inplay`), `getLatest` (`/livescores/latest`) |
| `LeaguesClient` | `getAll`, `getById`, `getLive`, `getByDateRange` (`/leagues/between/{start}/{end}`), `getByCountry`, `search` |
| `SeasonsClient` | `getAll`, `getById`, `search` |
| `StatisticsClient` | `getSeasonStatisticsByParticipant`, `getStageStatistics`, `getRoundStatistics` |
| `StandingsClient` | `getAll`, `getBySeason`, `getByRound`, `getCorrectionsBySeason`, `getLiveByLeague` |
| `TopscorersClient` | `getBySeason`, `getByStage` |
| `TeamsClient` | `getAll`, `getById`, `getByCountry`, `getBySeason`, `search` |
| `PlayersClient` | `getAll`, `getById`, `getByCountry`, `search`, `getLatest` |

### Metrics

Untouched. `SportmonksHttpClient.get()` continues to:

- Increment `sportmonks_api_calls_total{entity,endpoint,status}` (status ∈ `success` / `error`; `throttled` is gone because we no longer retry — a 429 produces one `error` increment plus the `sportmonks_rate_limit_throttled_total{entity}` increment, then throws).
- Observe `sportmonks_api_call_duration_seconds{entity,endpoint}`.
- Push `rate_limit` block contents into `RateLimitTracker`, which updates `sportmonks_rate_limit_remaining` / `_reset_seconds`.

The `entity` label is now sourced from the entity client (canonical, e.g. `"Fixture"`) rather than a caller-supplied option, so we drop the `entityLabelFromPath` heuristic for any path going through an entity client. The heuristic stays in [metrics.ts](backend/src/sportmonks/metrics.ts) for safety but becomes vestigial.

### Poller migration

[FixturePoller.ts:134](backend/src/sportmonks/FixturePoller.ts:134) becomes:

```typescript
const fixtures = await this.fixturesClient.getMulti(batch, {
    includes: ["scores", "state", "events", "participants", "statistics"],
    ctx,
});
```

The poller takes `FixturesClient` in its constructor instead of `SportmonksClient`. `Bootstrap.ts` constructs `SportmonksHttpClient` first, then `FixturesClient`, then passes the latter into the poller.

### Behavioural changes worth calling out

- **A single 429 now fails the tick.** The poller already logs + continues on errors (see [FixturePoller.ts:150-156](backend/src/sportmonks/FixturePoller.ts:150)), so user-visible effect is: one missed tick instead of one delayed tick. Next tick fires 5 s later as normal. `sportmonks_rate_limit_throttled_total` still increments, giving on-call the same signal — earlier and once-per-occurrence instead of once-per-attempt-sequence.
- **No `throttled` flag on responses.** Anything that branched on it (nothing today) would need to inspect metrics or catch `SportmonksHttpError` with `status === 429`.
- **`SportmonksGetResult<T>` type is removed.** Anyone importing it from `./sportmonks` would break — confirmed no external imports today.

### Out of scope (future iterations)

- Retry policy at the call site (e.g. an opt-in wrapper for foreground UI calls that want a single retry).
- Mutation endpoints (SportMonks v3 is read-only for the parts we use; we don't anticipate POSTs).
- Pagination helpers (most listing endpoints page; v1 entity methods expose the raw page, callers iterate themselves).
- Full DTOs covering every includable nested entity. We ship minimal DTOs and extend when a consumer needs the fields.

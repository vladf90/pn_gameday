# ADR 0003 — Public Fixtures-by-Day View

- **Status:** Superseded (partially) by [ADR 0004](0004-db-seeds-and-auth-gated-fixtures-view.md) — the public-access decision was reversed; the view now sits behind authentication.
- **Date:** 2026-05-22
- **Author:** Vlad Foamete

## Context

Today the app has nothing visible to an unauthenticated visitor — hitting `/` immediately redirects to `/login`. We have a fully functional `FixturesClient.getByDate(date)` in the backend (built in ADR 0002) that proxies SportMonks `/fixtures/date/{date}`, but no HTTP route exposes it and no UI consumes it.

We want a simple browsing experience: pick a date, see every fixture scheduled that day with kickoff time, teams, league, score, and state. The view should be public so a visitor (e.g. someone evaluating the product, or a logged-out user who just wants the scoreboard) can use it without creating an account. Authenticated users keep their current landing page at `/home`.

There is no business need yet for filtering by league or text, fixture history, or persistence beyond what SportMonks returns. Adding them now would be premature; the SportMonks endpoint is already a fast, complete source of truth for a single day.

## Decision

Add a single public `GET /fixtures?date=YYYY-MM-DD` route on `NoAuthRouter` that proxies through `FixturesClient.getByDate(date)` with `include=participants;league;scores;state`. On the frontend, swap the root route: `/` becomes a public `FixturesByDate` view (date picker + Antd table), and the existing `<Home />` moves to `/home`. Authenticated visitors hitting `/` are redirected to `/home` so their flow is unchanged.

### Rejected alternatives

- **Persist fixtures in our DB.** Adds an entity, migration, and a sync strategy with no current use case beyond rendering today's list. SportMonks is already the system of record.
- **Short-lived in-memory cache in front of SportMonks.** Defers the rate-limit question for one extra step but adds invalidation logic. We accept one upstream call per page load; the existing `RateLimitTracker` + Prometheus alerting will tell us if this becomes a problem.
- **Login-gated view with a "browse fixtures" link.** Defeats the stated goal of being usable without auth.
- **Date *range* picker.** SportMonks has `/fixtures/between/{start}/{end}` but it returns potentially huge result sets; a single-day picker matches both the user's ask and the size of a useful list view.
- **Server-side filtering by league / team name.** Out of scope for v1; the response for a single day is small enough that any future filter can be client-side.

## Technical Approach

### Backend

- **Route:** `GET /fixtures?date=YYYY-MM-DD` registered on `NoAuthRouter` in `Bootstrap.ts`. Returns the SportMonks response as `{ data: Fixture[] }` (the standard `BaseRouter` envelope).
- **Controller:** new `FixtureController` with a single `getByDate(ctx, request)` handler. The handler calls `FixturesClient.getByDate(date, { includes: ["participants", "league", "scores", "state"], ctx })` and returns the array.
- **Validator:** `GetFixturesByDateValidator extends ObjectValidator<{ date: string }>` with a string validator that enforces `YYYY-MM-DD` (regex + `Date.parse` sanity check). Invalid input → `ServiceError.build("invalid date", 400)`.
- **Fixture DTO:** extend `backend/src/sportmonks/types/Fixture.ts` to include the response shape for `participants`, `league`, `scores`, and `state` (the existing `LiveFixture` used by the poller already covers scores/state/participants — we can either reuse it or define a narrower `FixtureByDate` type; prefer the narrower type to avoid coupling to the poller's needs).
- **Permissions / RBAC:** none — `NoAuthRouter` skips JWT verification entirely, so no `permissions.ts` change is needed.
- **SportMonks errors:** propagate as `ServiceError` with the upstream HTTP status (already how `SportmonksHttpClient` throws). A 429 from SportMonks surfaces as a 429 to the browser; the frontend should render this as "rate limited, try again in a moment".

### Frontend

- **Request client:** new `FixtureRequestClient` in `frontend/src/clients/`. Extends `RequestClient` but the call must not attach an auth header (or must tolerate one not being present — the base class should already handle missing tokens; verify when implementing). One method: `getByDate(date: string): Promise<FixtureModel[]>`.
- **Types:** `frontend/src/common/types.ts` (or a new `fixtures.ts`) gets `FixtureModel` mirroring the backend DTO — `id`, `name`, `startingAt`, `league: { id, name, image_path, country? }`, `participants: [{ id, name, image_path, meta.location: "home"|"away" }]`, `scores: [...]`, `state: { state, short_name }`.
- **Component:** `Components/fixtures/FixturesByDate.tsx`.
  - Antd `DatePicker` defaulting to today (browser local TZ).
  - Antd `Table` grouped/sorted by league name, columns: kickoff time (local TZ), home vs away (with team logos via `image_path`), score (or "—" pre-match), state badge (NS / LIVE / FT / etc.).
  - Loading state: `Spin`. Empty state: Antd `Empty` with "No fixtures on this date". Error state: Antd `Alert` with retry button.
  - No detail click-through in v1 (deferred — see future work).
- **Routing changes in `App.tsx`:**
  - `<Route index element={<FixturesByDate />} />` — public, outside the `<Authenticated>` wrapper.
  - Move existing Home to `<Route path="/home" element={<Home />} />` inside the authenticated wrapper.
  - The authenticated wrapper gains a sibling redirect: if a logged-in user hits `/`, redirect to `/home`. Either via a small `<RootRedirect />` component that checks the auth provider, or by leaving `/` public for everyone and accepting that logged-in users can choose to view fixtures from there (simpler — pick this unless the redirect is explicitly wanted).
  - The catch-all `<Route path="*" element={<Navigate to="/" replace />} />` stays.

### Edge cases / decisions baked in

- **Timezone:** SportMonks returns `starting_at` as UTC ISO. Display formatted in the browser's local timezone via `dayjs` (already a transitive Antd dep). Date picker emits dates in browser-local time, which is what SportMonks expects (it interprets `/fixtures/date/2026-05-22` against the account's fixture calendar; close-enough for v1).
- **Refresh / live updates:** none in v1. Score/state are a snapshot at request time. A future iteration can add polling or wire the live-snapshot WebSocket if it exists.
- **Rate limiting:** the public route is one upstream call per request. Acceptable risk given current traffic; revisit if `_throttled_total` metric starts ticking up. Adding a cache is cheap when needed.
- **Abuse / scraping:** the endpoint exposes the same data SportMonks already sells. We're paying for the requests, so a future hardening step might rate-limit by IP — out of scope here.

### Future work (not in this ADR)

- Fixture detail page (`/fixtures/:id`) with statistics, events, lineup.
- Date-range view, league filter, team filter.
- Live polling / WebSocket hookup for in-progress games.
- Caching layer in front of SportMonks if rate limits start biting.

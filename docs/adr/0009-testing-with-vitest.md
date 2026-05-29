# 0009 — Testing with Vitest (Unit + Component + Integration)

## Status

Accepted — 2026-05-28

## Context

The repo has no automated test suite. The only automated checks today are:

- `pnpm lint` in each workspace.
- Four ad-hoc smoke scripts in [backend/scripts/](../../backend/scripts):
  `bootstrap-import-smoke.ts`, `metrics-smoke.ts`, `metrics-endpoint-smoke.ts`,
  `sportmonks-smoke.ts`. These are run by hand, are not invoked from any
  package.json script, and don't assert in a way a CI gate can consume.

As the codebase has grown (RBAC, SportMonks integration, watch-along sessions,
overlay tenancy, single-session enforcement — ADRs 0001–0008), regressions
have started to land that an ordinary unit test would have caught. We need a
real test runner wired into both workspaces and a small set of exemplar tests
that establish the pattern future PRs will copy.

Constraints worth surfacing:

- **Monorepo with two different runtimes.** Frontend = Vite 5 + React 18 +
  Antd 5 + Refine 4. Backend = Node 22 + Express 4 + TypeORM 0.3 +
  TypeScript 4.9 (CommonJS, ts-node).
- **Backend uses real I/O.** Repositories sit on TypeORM/Postgres; mocking
  them at the repository boundary is the standard pattern, but for the
  repository layer itself we want fidelity against the real database (migrations
  included).
- **Frontend code is tightly coupled to Refine + Antd providers.** Component
  tests need to render inside those providers or use a thin test-only wrapper.

## Decision

Adopt **Vitest** as the single test runner for both workspaces, plus:

- **React Testing Library + jsdom** for frontend component tests.
- **@testcontainers/postgresql** for backend integration tests against an
  ephemeral Postgres container.
- A root-level `pnpm test` that fans out to both workspaces, mirroring the
  existing `pnpm lint` pattern.

Delete the four smoke scripts in `backend/scripts/` as part of this change —
they encoded informal invariants for environments without DB/JWT keys, which
testcontainers + unit tests now cover more rigorously.

### Why Vitest (vs. alternatives)

| Alternative | Why rejected |
|---|---|
| **Jest** | Would force a second TS transformer stack (`ts-jest` + babel) since the frontend is Vite-native. Two runners or one painful config — net cost higher than Vitest. |
| **`node:test`** | Zero deps but no jsdom support, weaker mocking API (`mock.method` vs `vi.mock`/`vi.spyOn`), no snapshot ergonomics for component tests. Wrong fit for the frontend. |
| **Mocha + Chai + Sinon** | Three deps to assemble what Vitest ships in one. Adds maintenance overhead with no upside. |

Vitest specifically:

- Reuses the frontend's existing Vite config — no separate transformer pipeline.
- Runs backend TS natively via esbuild — no `ts-jest` cache, no `--experimental-vm-modules` flags.
- One mocking API (`vi.mock`, `vi.spyOn`, `vi.fn`) and one CLI across both packages.
- Built-in coverage via `@vitest/coverage-v8`.

### Why testcontainers (vs. shared local Postgres or compose service)

- Hermetic: each `pnpm test` run gets a fresh container, no leftover rows from
  a previous run.
- No manual "create `pn_gameday_test` DB" step for new contributors.
- Migrations are exercised on every run, catching breakage that a long-lived
  test DB would mask.
- Trade-off accepted: Docker must be running locally and first-run is slower
  (~10s pull + boot). Worth it for hermeticity.

## Technical approach

### Workspace layout

```
backend/
├── vitest.config.ts          # node env, threads, testTimeout for integration
├── src/**/*.test.ts          # unit tests colocated with source
├── test/
│   ├── setup.ts              # global beforeAll/afterAll
│   ├── helpers/
│   │   ├── postgres.ts       # testcontainers boot + migration runner
│   │   └── factories.ts      # entity factories
│   └── integration/
│       └── **/*.test.ts      # repository / supertest tests
└── package.json              # `test`, `test:unit`, `test:integration` scripts

frontend/
├── vitest.config.ts          # jsdom env, RTL setup, alias from vite.config
├── src/**/*.test.tsx         # component + hook tests colocated with source
├── test/
│   └── setup.ts              # @testing-library/jest-dom, cleanup, MSW (if added later)
└── package.json              # `test` script

package.json (root)           # `pnpm test` runs both workspaces in parallel
```

### Backend — unit tests

- Colocated `*.test.ts` next to the module under test.
- Plain `vi.mock`/`vi.fn` for repositories, fetch, time.
- Targets: `ObjectValidator` subclasses, `ServiceError`, permission helpers in
  `config/permissions.ts`, SportMonks `RateLimitTracker`, controller methods
  with mocked repos.

### Backend — integration tests

- `test/helpers/postgres.ts` exposes `setupTestDb()` which:
  1. Boots a `postgres:16` container via `@testcontainers/postgresql`.
  2. Builds a `DataSource` pointed at the container.
  3. Runs migrations from `src/database/migrations/`.
  4. Returns the `DataSource` plus a `cleanup()` hook.
- Tests use `beforeAll` to acquire the DataSource and `beforeEach` to truncate
  tables (faster than recreating the container per file).
- HTTP-layer tests use `supertest` against an Express app instance constructed
  the same way `Bootstrap` does, but with the test DataSource injected.

### Frontend — component tests

- jsdom environment via `vitest.config.ts`.
- `test/setup.ts` imports `@testing-library/jest-dom/vitest` and registers
  `afterEach(cleanup)`.
- A `renderWithProviders` helper wraps components in `<MemoryRouter>` +
  `<Refine>` with stubbed `authProvider`/`dataProvider`/`accessControlProvider`
  so component tests don't repeat boilerplate.
- Request clients are mocked at the module boundary, not at the network layer
  — the network layer is `RequestClient` which we own and unit-test separately.

### Initial exemplar tests (delivered in this feature)

At least one of each, to establish the pattern:

1. Backend pure-unit — a validator (`ObjectValidator` subclass).
2. Backend pure-unit — a controller method with a mocked repository.
3. Backend integration — a repository test against the testcontainers DB.
4. Frontend component — one component rendered with `renderWithProviders`.
5. Frontend hook/util — `common/permissions.ts` (`canAccessResource`).

Coverage thresholds are **not** enforced in this iteration — exemplars only.
A later ADR can introduce thresholds once we know what's realistic.

### Scripts removed

- `backend/scripts/bootstrap-import-smoke.ts`
- `backend/scripts/metrics-smoke.ts`
- `backend/scripts/metrics-endpoint-smoke.ts`
- `backend/scripts/sportmonks-smoke.ts`

Delete the `backend/scripts/` directory if no other files land there during
implementation.

### Scripts added (per package.json)

- Backend: `test`, `test:unit`, `test:integration`, `test:watch`.
- Frontend: `test`, `test:watch`.
- Root: `test` → `pnpm -r --parallel test`.

### Out of scope

- GitHub Actions CI integration (deferred — user opted for local harness only).
- E2E browser tests (Playwright). Tracked as a future ADR if needed.
- Coverage thresholds and reporting gates.
- Test data fixtures beyond minimal factories for the exemplar tests.

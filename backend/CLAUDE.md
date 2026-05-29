# Backend

Express.js + TypeORM API server.

## Stack

- **Runtime:** Node.js 20.3.0, TypeScript 4.9
- **Framework:** Express.js 4.17
- **ORM:** TypeORM 0.3 with PostgreSQL
- **Auth:** JWT (RS256, base64-encoded keys in env vars) with role-based access control
- **Logging:** Winston with request context
- **Validation:** Custom `ObjectValidator` pattern

## Architecture

```
backend/src/
├── Bootstrap.ts              # App init — all routes registered here
├── index.ts                  # Entry point
├── config/
│   └── permissions.ts        # RBAC role definitions and permission checks
├── controller/               # Request handlers + validators + request/response interfaces
├── database/
│   ├── data-source.ts        # TypeORM DataSource configuration
│   ├── entities/             # TypeORM entities (one file per entity)
│   ├── migrations/           # Schema migrations (timestamp-prefixed)
│   └── repositories/         # Custom repository classes
├── router/
│   ├── BaseRouter.ts         # Abstract router — handles auth, validation, RBAC, response wrapping
│   ├── NoAuthRouter.ts       # Public routes (login)
│   └── UserAuthRouter.ts     # Authenticated routes (JWT verification)
├── validator/                # Validator base classes (ObjectValidator, NumberValidator, etc.)
├── Logger/                   # Winston logger with Context
└── utils/
    └── ServiceError.ts       # Error class with HTTP status codes
```

## Patterns — How to Add a New Resource

### 1. Entity (`database/entities/NewEntity.ts`)

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("new_entity")
export class NewEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: "display_name", type: "varchar", length: 255, nullable: true })
    displayName: string;
}
```

- Table names: **singular** `snake_case`
- Column names: `snake_case` in DB, `camelCase` as entity properties (mapped via `@Column({ name: "snake_case" })`)
- Primary key: `id` via `@PrimaryGeneratedColumn()`

### 2. Migration

```bash
pnpm migration:generate -- src/database/migrations/CreateNewEntityTable
```

Then register the entity in `database/data-source.ts`.

### 3. Controller (`controller/NewEntityController.ts`)

Handler methods are arrow functions with signature `(ctx: Context, auth: UserAuth, request: T) => Promise<R>`.
Validators extend `ObjectValidator<T>` and register field validators in the constructor.

### 4. Register Routes (`Bootstrap.ts`)

```typescript
authRouter.get("/new-entities", controller.getAll, undefined,
    { resource: 'new_entity', action: 'read' });
authRouter.get("/new-entities/:id", controller.get, undefined,
    { resource: 'new_entity', action: 'read' });
authRouter.post("/new-entities", controller.create, new CreateValidator(),
    { resource: 'new_entity', action: 'create' });
authRouter.patch("/new-entities/:id", controller.update, new UpdateValidator(),
    { resource: 'new_entity', action: 'update' });
authRouter.delete("/new-entities/:id", controller.delete, new DeleteValidator(),
    { resource: 'new_entity', action: 'delete' });
```

### 5. Add Permissions (`config/permissions.ts`)

Add the new resource to the relevant role definitions.

## API Conventions

- All routes go through `BaseRouter` which wraps responses as `{ data: T, code: number, message?: string }`
- Errors use `ServiceError.build(message, httpStatusCode)` — never throw raw errors
- Use proper HTTP methods to express intent:
  - `GET /<resource>` — list
  - `GET /<resource>/:id` — fetch one
  - `POST /<resource>` — create
  - `PATCH /<resource>/:id` — update (partial; use `PUT` only when the request fully replaces the resource)
  - `DELETE /<resource>/:id` — delete
- Sub-resource associations follow the same shape:
  - `POST /<resource>/:id/<sub-resource>` — add association
  - `DELETE /<resource>/:id/<sub-resource>/:subId` — remove association
- Non-CRUD actions keep an action segment in the path: `POST /<resource>/:id/<action>` (e.g. `POST /auth/login`, `POST /sessions/:id/start`)
- URL params are auto-parsed as numbers when possible (see `BaseRouter.post()`)

## RBAC

Roles defined in `config/permissions.ts`. Permission format: `resource:action` (e.g., `user:create`).
Wildcards supported: `*:*` (admin), `user:*` (all actions on user).

## Testing

- **Runner:** Vitest (see [docs/adr/0009-testing-with-vitest.md](../docs/adr/0009-testing-with-vitest.md)).
- **Layout:** tests are NOT colocated with source. They live under `test/<category>/`, mirroring the `src/` tree underneath:
  - `test/unit/<area>/Foo.test.ts` — fast, no I/O. Use `vi.mock` for module-level deps (`bcrypt`, `jsonwebtoken`, …) and inject plain stubs for repositories. See `test/unit/controller/UserController.test.ts` as the exemplar.
  - `test/integration/<area>/Foo.test.ts` — real Postgres via testcontainers. See `test/integration/database/UserRepository.test.ts` as the exemplar.
  - `test/helpers/` — shared factories + setup utilities (`setupTestDb`, `makeUserAttrs`, …).
- Scripts: `pnpm --filter backend test` (all), `test:unit`, `test:integration`, `test:watch`.

### Integration tests — Docker

Integration tests boot a real `postgres:18` via [testcontainers](https://node.testcontainers.org/) — matching the production Postgres major version. Docker (or colima) must be running locally.

- **Docker Desktop:** works out of the box.
- **colima:** works out of the box too — `test/helpers/postgres.ts` auto-detects the default colima socket (`~/.colima/default/docker.sock`) when `DOCKER_HOST` is unset, since testcontainers ignores the `docker` CLI's contexts (otherwise it fails with "Could not find a working container runtime strategy"). Only if you run colima under a **non-default profile** do you need to export it yourself:
  ```bash
  export DOCKER_HOST="unix://$HOME/.colima/<profile>/docker.sock"
  # or: eval "$(colima env)"
  ```
  The `TESTCONTAINERS_*` env vars (`RYUK_DISABLED`, `DOCKER_SOCKET_OVERRIDE`) and the `DOCKER_HOST` fallback are all set automatically inside `test/helpers/postgres.ts`.

## Observability

- `GET /metrics` exposes Prometheus metrics (Node runtime + SportMonks integration). The endpoint is **unauthenticated by design** so scrapers don't need credentials — protect it via reverse proxy / firewall / private subnet in production.
- Metrics are defined in `src/sportmonks/metrics.ts` on a dedicated `Registry` instance (no global default).

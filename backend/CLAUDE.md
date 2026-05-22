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
authRouter.post("/new-entities", controller.create, new CreateValidator(),
    { resource: 'new_entity', action: 'create' });
authRouter.post("/new-entities/:id/update", controller.update, new UpdateValidator(),
    { resource: 'new_entity', action: 'update' });
authRouter.post("/new-entities/:id/delete", controller.delete, new DeleteValidator(),
    { resource: 'new_entity', action: 'delete' });
```

### 5. Add Permissions (`config/permissions.ts`)

Add the new resource to the relevant role definitions.

## API Conventions

- All routes go through `BaseRouter` which wraps responses as `{ data: T, code: number, message?: string }`
- Errors use `ServiceError.build(message, httpStatusCode)` — never throw raw errors
- `POST` is used for create, update, and delete (not `PUT`/`DELETE`)
- Update routes: `POST /<resource>/:id/update`
- Delete routes: `POST /<resource>/:id/delete`
- URL params are auto-parsed as numbers when possible (see `BaseRouter.post()`)

## RBAC

Roles defined in `config/permissions.ts`. Permission format: `resource:action` (e.g., `user:create`).
Wildcards supported: `*:*` (admin), `user:*` (all actions on user).

## Observability

- `GET /metrics` exposes Prometheus metrics (Node runtime + SportMonks integration). The endpoint is **unauthenticated by design** so scrapers don't need credentials — protect it via reverse proxy / firewall / private subnet in production.
- Metrics are defined in `src/sportmonks/metrics.ts` on a dedicated `Registry` instance (no global default).

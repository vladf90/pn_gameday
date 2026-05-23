# ADR 0004 — DB Seeds, User Migration, and Auth-Gated Fixtures View

- **Status:** Proposed
- **Date:** 2026-05-23
- **Author:** Vlad Foamete
- **Supersedes (partially):** [ADR 0003](0003-public-fixtures-by-day-view.md) — reverts the "public `/`" decision

## Context

Three loose ends, bundled because they touch the same boot path:

1. **No way to bootstrap a user.** The `user` entity, login flow, and JWT signing are all wired up, but a fresh database has no rows in `user`, so a developer can't log in. There's no migration for the `user` table either — it exists only because `synchronize: true` auto-creates it from the entity on `AppDataSource.initialize()`. That violates the project rule in `CLAUDE.md` (*"Never use `synchronize: true` — always create migrations for schema changes"*).

2. **No seeder infrastructure.** `data-source.ts` already declares `seeds: ["src/database/seeds/**/*.ts"]` and `package.json` declares `pnpm seed:run` → `ts-node src/database/seed.ts`. `typeorm-extension` is in devDependencies. But `src/database/seed.ts` and the `seeds/` folder don't exist, so `pnpm seed:run` fails immediately.

3. **Public fixtures view is no longer wanted.** ADR 0003 made `FixturesByDate` the public root (`GET /` and `GET /fixtures?date=...`). We're reversing that — the view goes behind authentication.

These are small enough to do in one ADR. They share `Bootstrap.ts`, `data-source.ts`, and the boot story; splitting them would force three near-identical PRs against the same files.

## Decision

1. **Add a `CreateUserTable` migration**, timestamped *before* `1779452232000-CreateSessionTables.ts` so a fresh database can run migrations in order. The migration mirrors the current entity exactly (so the existing schema in dev DBs is unchanged after migration replay).

2. **Flip `synchronize: false`** in `data-source.ts`. Schema source of truth moves to migrations. Re-running `pnpm migration:run` against an existing dev DB will be a no-op (the user/session tables already exist) — TypeORM tracks applied migrations via the `migrations` table, and the new user migration will need to be marked as applied via `migration:run --fake` or by inserting the row manually if the table exists. We'll document this in the issue body.

3. **Wire up `typeorm-extension` seeder:**
   - `backend/src/database/seed.ts` — entry point. Initializes the DataSource then calls `runSeeders(AppDataSource)`.
   - `backend/src/database/seeds/UserSeeder.ts` — single seeder class implementing `Seeder`.

4. **User seed behaviour:**
   - Reads `SEED_USER_USERNAME` and `SEED_USER_PASSWORD` from env.
   - **If either is missing or empty, log a skip message and exit cleanly (exit code 0).** This is the dev-friendly default and makes `pnpm seed:run` safe to run in environments that don't want seeded users (e.g. CI integration tests with their own fixtures).
   - **Idempotent:** if a user with that username already exists, skip silently.
   - **Defaults for the other required fields:**
     - `email` = `SEED_USER_USERNAME` (works because the username validator is an `EmailValidator` — see [UserController.ts:86](../../backend/src/controller/UserController.ts))
     - `firstName` = `"Admin"`, `lastName` = `"User"`, `role` = `"admin"`
   - Password is hashed with `bcrypt` (same library and salt rounds the rest of the codebase uses — `bcrypt` is in `backend/package.json`).

5. **Move FixturesByDate behind auth:**
   - **Backend:** move `router.get("/fixtures", ...)` from `NoAuthRouter` to `UserAuthRouter` in [Bootstrap.ts:105](../../backend/src/Bootstrap.ts), with the existing RBAC pattern (`{ resource: 'fixture', action: 'read' }`).
   - **Frontend:** move `<Route index element={<FixturesByDate />} />` from the public section into the `<Authenticated>` wrapper in [App.tsx](../../frontend/src/App.tsx). Unauthenticated visitors hitting `/` get redirected to `/login`, restoring pre-ADR-0003 behaviour for the root path.
   - **Permissions:** add `fixture:read` to the `admin` role (and to whatever default role logged-in users have — currently only `admin` exists in [permissions.ts](../../backend/src/config/permissions.ts), to be verified during implementation).

### Rejected alternatives

- **Hardcoded admin user in the migration.** Would put credentials into source control. Seeds via env vars keep secrets out of git.
- **Three separate ADRs.** Small decisions on shared boot/auth paths; bundling cuts churn.
- **Keep `synchronize: true` and add only the migration.** Defeats the purpose of the migration (it'd be documentary at best, lying-about-schema at worst). The project rule is unambiguous.
- **Upsert / overwrite on seed re-run.** Footgun: would silently overwrite a developer's chosen password if they changed it post-seed. Skip-if-exists is the safer default; for password rotation, drop the row and re-seed.
- **Fail loudly on seed re-run.** Annoying for the `pnpm seed:run` after `pnpm migration:run` workflow that we want to encourage.

## Technical Approach

### Files

```
backend/src/
├── Bootstrap.ts                                          # move /fixtures route to authRouter
├── config/permissions.ts                                 # add fixture:read to admin
├── database/
│   ├── data-source.ts                                    # synchronize: false
│   ├── migrations/
│   │   ├── 1779452231000-CreateUserTable.ts              # NEW — before session migration
│   │   └── 1779452232000-CreateSessionTables.ts          # unchanged
│   ├── seed.ts                                           # NEW — seeder entry point
│   └── seeds/
│       └── UserSeeder.ts                                 # NEW
frontend/src/
└── App.tsx                                               # move <FixturesByDate /> behind <Authenticated>
docs/adr/
└── 0004-...md                                            # this file
.env.example                                              # document SEED_USER_USERNAME / SEED_USER_PASSWORD
```

### Migration shape — `CreateUserTable1779452231000`

`up()`:

```sql
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "username" varchar(255) NOT NULL,
    "password" varchar(255) NOT NULL,
    "first_name" varchar(255) NOT NULL,
    "last_name" varchar(255) NOT NULL,
    "email" varchar(255) NOT NULL,
    "role" varchar(50) NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_user_id" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IDX_user_username" ON "user" ("username");
CREATE UNIQUE INDEX "IDX_user_email" ON "user" ("email");
```

`down()`: drop the indexes and the table in reverse order.

### Seeder shape

```typescript
// backend/src/database/seeds/UserSeeder.ts
export default class UserSeeder implements Seeder {
    async run(dataSource: DataSource): Promise<void> {
        const username = process.env.SEED_USER_USERNAME;
        const password = process.env.SEED_USER_PASSWORD;
        if (!username || !password) {
            console.log("UserSeeder: SEED_USER_USERNAME / SEED_USER_PASSWORD not set — skipping");
            return;
        }
        const repo = dataSource.getRepository(User);
        if (await repo.findOne({ where: { username } })) {
            console.log(`UserSeeder: user "${username}" already exists — skipping`);
            return;
        }
        const hashed = await bcrypt.hash(password, 10);
        await repo.insert({
            username,
            password: hashed,
            email: username,
            firstName: "Admin",
            lastName: "User",
            role: "admin",
        });
        console.log(`UserSeeder: created user "${username}"`);
    }
}
```

### Edge cases / decisions baked in

- **Existing dev databases.** Devs with a populated `user` and `session` schema (from `synchronize: true`) will need to mark the new migrations as already-run. We'll document `pnpm typeorm migration:run --fake` in the migration issue, or alternatively `INSERT INTO migrations ...`. Production fresh-DB flow: `pnpm migration:run` → `pnpm seed:run`.
- **Seed in CI.** CI doesn't need to seed; just don't set `SEED_USER_*`. The seeder logs a skip line and exits 0. No CI changes required.
- **Bcrypt salt rounds.** Use `10` (default and what most of the ecosystem uses); the user controller doesn't currently hash on a "create user" path because no such path exists, so there's no reference value in the codebase to match.
- **Email = username.** The username column is validated as an email at login time, so it doubles as the email. Cleaner than asking for both in env.
- **Role = `"admin"`.** The seed creates a privileged user (the seeded user is expected to be the developer's local login). If a non-admin seed is ever needed, a future seeder can add a `SEED_USER_ROLE` knob.
- **Permissions for the moved fixtures route.** `permissions.ts` needs `fixture:read` on whichever role(s) should access it. Cross-check during implementation — the resource/action pair will fail closed if not added.

### Future work (not in this ADR)

- Public scoreboard via a separate, narrower endpoint if we later want one.
- "Create user" admin UI / API (only the seed path exists today).
- Multiple seeded users (e.g. roles fixture).
- Forced password rotation / password change endpoint.

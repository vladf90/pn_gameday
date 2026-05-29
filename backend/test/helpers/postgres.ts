/**
 * Test-database lifecycle for backend integration tests.
 *
 * Requires Docker (or colima/compatible) to be running locally — testcontainers
 * launches a real `postgres:16` instance per `setupTestDb()` call. First boot
 * pulls the image (~100 MB) and takes ~10s; subsequent boots are ~1–2s.
 *
 * **colima users:** set `DOCKER_HOST` so testcontainers can find the daemon
 * (Docker Desktop sets this automatically; colima does not):
 *
 *   export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
 *   # or: eval "$(colima env)"
 *
 * Usage (per test file):
 *
 *   let db: TestDb;
 *   beforeAll(async () => { db = await setupTestDb(); }, 180_000);
 *   afterAll(async () => { await db.cleanup(); }, 30_000);
 *   beforeEach(async () => { await db.truncate(); });
 *
 * Why the singleton `AppDataSource` is mutated rather than a fresh DataSource:
 * the repository layer constructs itself off `AppDataSource.getRepository(...)`
 * at instantiation time (see `database/repositories/*.ts`). Pointing the
 * singleton at the container lets the real repository classes run unchanged.
 *
 * Why migrations are passed as classes instead of `["src/database/migrations/*.ts"]`:
 * TypeORM's glob loader uses Node's native require, which can't execute `.ts`
 * without a ts-node hook registered. Vitest's esbuild transform applies to
 * test files but not to runtime-loaded modules. Passing the migration classes
 * directly sidesteps the issue and is more deterministic anyway.
 */
// Safe testcontainers defaults — applied before the @testcontainers/postgresql
// import so the env is set when the library reads it.
//
// - RYUK_DISABLED=true skips the reaper container (the orphan-cleanup
//   sidecar). We do explicit teardown via `cleanup()` in `afterAll`, so
//   reaper would just add overhead + a bind-mount that doesn't work on
//   colima out of the box (the VM can't mount the host's socket path).
// - DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock is the path the daemon
//   sees from inside containers; it's the same on Docker Desktop and
//   colima, so hard-coding it is safe.
process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";
process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= "/var/run/docker.sock";

import {PostgreSqlContainer, type StartedPostgreSqlContainer} from "@testcontainers/postgresql";

import {AppDataSource} from "../../src/database/data-source";
import {CreateUserTable1779452231000} from "../../src/database/migrations/1779452231000-CreateUserTable";
import {CreateSessionTables1779452232000} from "../../src/database/migrations/1779452232000-CreateSessionTables";
import {AddSessionOwnershipAndLifecycle1779452233000} from "../../src/database/migrations/1779452233000-AddSessionOwnershipAndLifecycle";
import {AddSessionOverlayToken1779452234000} from "../../src/database/migrations/1779452234000-AddSessionOverlayToken";

const MIGRATIONS = [
    CreateUserTable1779452231000,
    CreateSessionTables1779452232000,
    AddSessionOwnershipAndLifecycle1779452233000,
    AddSessionOverlayToken1779452234000,
];

export interface TestDb {
    container: StartedPostgreSqlContainer;
    /** Truncates every entity table; faster than recreating the container per test. */
    truncate: () => Promise<void>;
    /** Tears down the data source connection and stops the container. */
    cleanup: () => Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
    const container = await new PostgreSqlContainer("postgres:16").start();

    AppDataSource.setOptions({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        username: container.getUsername(),
        password: container.getPassword(),
        database: container.getDatabase(),
        migrations: MIGRATIONS,
        logging: false,
    });

    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    return {
        container,
        truncate: async () => {
            const tableNames = AppDataSource.entityMetadatas
                .map((meta) => `"${meta.tableName}"`)
                .join(", ");
            if (tableNames.length === 0) {
                return;
            }
            await AppDataSource.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
        },
        cleanup: async () => {
            if (AppDataSource.isInitialized) {
                await AppDataSource.destroy();
            }
            await container.stop();
        },
    };
}

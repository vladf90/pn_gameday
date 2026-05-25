import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds per-user ownership and lifecycle tracking to `session` (ADR 0005).
 *
 * Schema changes:
 *   1. `user_id` FK on `session` (NOT NULL). Existing rows are backfilled to
 *      the smallest existing `user.id` — in practice this is the seeded admin
 *      from ADR 0004's UserSeeder. Sessions can't have existed without a user
 *      having logged in to create them, so this assumes at least one user row
 *      exists; if not, the `ALTER COLUMN SET NOT NULL` will fail, which is the
 *      correct failure mode (we don't silently invent a user).
 *   2. `ended_at TIMESTAMP NULL` — when null, the session is active.
 *   3. Partial index on `(user_id) WHERE ended_at IS NULL` — keeps the
 *      "list my active sessions" query O(active), regardless of how big the
 *      ended-session tail becomes.
 */
export class AddSessionOwnershipAndLifecycle1779452233000 implements MigrationInterface {
    name = 'AddSessionOwnershipAndLifecycle1779452233000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add nullable user_id so existing rows survive the column add.
        await queryRunner.query(`
            ALTER TABLE "session"
            ADD COLUMN "user_id" integer
        `);

        // 2. Backfill to the smallest existing user id. No-op when `session` is empty.
        await queryRunner.query(`
            UPDATE "session"
            SET "user_id" = (SELECT MIN("id") FROM "user")
            WHERE "user_id" IS NULL
        `);

        // 3. Promote to NOT NULL. Fails fast if backfill left any nulls
        // (would indicate an empty `user` table — a state we won't repair here).
        await queryRunner.query(`
            ALTER TABLE "session"
            ALTER COLUMN "user_id" SET NOT NULL
        `);

        // 4. FK + cascade — deleting a user removes their sessions and (via the
        // existing FK_session_fixture_session_id) their session_fixture rows.
        await queryRunner.query(`
            ALTER TABLE "session"
            ADD CONSTRAINT "FK_session_user_id"
            FOREIGN KEY ("user_id") REFERENCES "user"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        // 5. Lifecycle column.
        await queryRunner.query(`
            ALTER TABLE "session"
            ADD COLUMN "ended_at" TIMESTAMP NULL
        `);

        // 6. Partial index for cheap "active sessions" lookup. Per the ADR,
        // this is the index that makes the listing path scale.
        await queryRunner.query(`
            CREATE INDEX "IDX_session_user_active"
            ON "session" ("user_id")
            WHERE "ended_at" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_session_user_active"`);
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "ended_at"`);
        await queryRunner.query(`ALTER TABLE "session" DROP CONSTRAINT "FK_session_user_id"`);
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "user_id"`);
    }
}

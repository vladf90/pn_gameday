import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the per-session opaque overlay token (ADR 0008).
 *
 * Schema changes:
 *   1. `pgcrypto` extension — needed for `gen_random_bytes` in the backfill.
 *   2. `overlay_token varchar(64)` column on `session`.
 *   3. Backfill every existing row with a fresh 32-byte hex token. Each row
 *      gets an independent random value (the subquery is evaluated per row).
 *   4. Promote the column to `NOT NULL` once the backfill is in place.
 *   5. Unique index `UQ_session_overlay_token` so token-based lookups are O(1)
 *      and accidental duplicates surface as constraint violations.
 *
 * `down()` drops the index and the column. `pgcrypto` is intentionally left
 * enabled — other migrations may come to depend on it, and dropping an
 * extension is a heavier change than we want on a rollback.
 */
export class AddSessionOverlayToken1779452234000 implements MigrationInterface {
    name = 'AddSessionOverlayToken1779452234000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

        await queryRunner.query(`
            ALTER TABLE "session"
            ADD COLUMN "overlay_token" varchar(64)
        `);

        await queryRunner.query(`
            UPDATE "session"
            SET "overlay_token" = encode(gen_random_bytes(32), 'hex')
            WHERE "overlay_token" IS NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "session"
            ALTER COLUMN "overlay_token" SET NOT NULL
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_session_overlay_token"
            ON "session" ("overlay_token")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "UQ_session_overlay_token"`);
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "overlay_token"`);
    }
}

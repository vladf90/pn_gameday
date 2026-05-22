import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSessionTables1779452232000 implements MigrationInterface {
    name = 'CreateSessionTables1779452232000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "session" (
                "id" SERIAL NOT NULL,
                "name" character varying(255) NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_session_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "session_fixture" (
                "session_id" integer NOT NULL,
                "sportmonks_fixture_id" bigint NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_session_fixture" PRIMARY KEY ("session_id", "sportmonks_fixture_id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_session_fixture_sportmonks_fixture_id"
            ON "session_fixture" ("sportmonks_fixture_id")
        `);

        await queryRunner.query(`
            ALTER TABLE "session_fixture"
            ADD CONSTRAINT "FK_session_fixture_session_id"
            FOREIGN KEY ("session_id") REFERENCES "session"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "session_fixture" DROP CONSTRAINT "FK_session_fixture_session_id"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_session_fixture_sportmonks_fixture_id"
        `);
        await queryRunner.query(`DROP TABLE "session_fixture"`);
        await queryRunner.query(`DROP TABLE "session"`);
    }
}

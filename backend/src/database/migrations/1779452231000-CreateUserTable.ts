import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserTable1779452231000 implements MigrationInterface {
    name = 'CreateUserTable1779452231000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "user" (
                "id" SERIAL NOT NULL,
                "username" character varying(255) NOT NULL,
                "password" character varying(255) NOT NULL,
                "first_name" character varying(255) NOT NULL,
                "last_name" character varying(255) NOT NULL,
                "email" character varying(255) NOT NULL,
                "role" character varying(50) NOT NULL DEFAULT 'user',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_user_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_user_username" ON "user" ("username")
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_user_email" ON "user" ("email")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_user_email"`);
        await queryRunner.query(`DROP INDEX "IDX_user_username"`);
        await queryRunner.query(`DROP TABLE "user"`);
    }
}

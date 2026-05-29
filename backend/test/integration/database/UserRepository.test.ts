/**
 * Exemplar integration test (issue #91, ADR 0009).
 *
 * Exercises `UserRepository` against a real Postgres instance launched by
 * testcontainers — verifies that the entity mappings, the migrations, and
 * the repository's column-selection logic all line up end-to-end.
 *
 * Copy this file as the template when adding new repository integration tests:
 *  - `beforeAll`: boot the DB (one container per test FILE).
 *  - `afterAll`: tear down.
 *  - `beforeEach`: truncate (cheap; avoids per-test container churn).
 */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {setupTestDb, type TestDb} from "../../helpers/postgres";
import {makeUserAttrs} from "../../helpers/factories";
import {UserRepository} from "../../../src/database/repositories/UserRepository";

describe("UserRepository (integration)", () => {
    let db: TestDb;
    let repo: UserRepository;

    beforeAll(async () => {
        db = await setupTestDb();
        // Construct the repository AFTER the data source points at the
        // container — its constructor pulls `Repository<User>` from the
        // singleton at instantiation time.
        repo = new UserRepository();
    }, 180_000);

    afterAll(async () => {
        await db.cleanup();
    }, 30_000);

    beforeEach(async () => {
        await db.truncate();
    });

    it("inserts a user and returns it by username with the password column", async () => {
        const attrs = makeUserAttrs({username: "alice", role: "admin"});
        await repo.insertUser(
            attrs.username,
            attrs.password,
            attrs.firstName,
            attrs.lastName,
            attrs.email,
            attrs.role,
        );

        const result = await repo.getUser("alice");
        expect(result).toEqual({
            id: expect.any(Number),
            username: "alice",
            password: attrs.password,
            role: "admin",
        });
    });

    it("returns undefined for an unknown username", async () => {
        expect(await repo.getUser("ghost")).toBeUndefined();
    });

    it("getUserById returns the user profile without the password column", async () => {
        const attrs = makeUserAttrs({username: "bob"});
        await repo.insertUser(
            attrs.username,
            attrs.password,
            attrs.firstName,
            attrs.lastName,
            attrs.email,
            attrs.role,
        );
        const inserted = await repo.getUser("bob");

        const profile = await repo.getUserById(inserted!.id);
        expect(profile).toEqual({
            id: inserted!.id,
            username: "bob",
            firstName: attrs.firstName,
            lastName: attrs.lastName,
            avatarUrl: "",
        });
        // Sanity: the profile shape deliberately omits `password` and `role`.
        expect(profile).not.toHaveProperty("password");
    });

    it("defaults the role to 'user' when not provided", async () => {
        await repo.insertUser("carol", "pw", "Carol", "Connor", "carol@example.test");
        const result = await repo.getUser("carol");
        expect(result?.role).toBe("user");
    });
});

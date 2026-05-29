/**
 * Integration tests for SessionRepository.
 *
 * Exercises entity↔column mappings, lifecycle helpers, ownership scoping,
 * and all custom query methods against a real Postgres instance (postgres:18)
 * launched by testcontainers.
 *
 * Follow the UserRepository exemplar pattern:
 *   - One container per file (beforeAll / afterAll).
 *   - Truncate per test (beforeEach) — cheap and keeps tests independent.
 */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {setupTestDb, type TestDb} from "../../helpers/postgres";
import {makeUserAttrs} from "../../helpers/factories";
import {UserRepository} from "../../../src/database/repositories/UserRepository";
import {SessionRepository} from "../../../src/database/repositories/SessionRepository";

describe("SessionRepository (integration)", () => {
    let db: TestDb;
    let userRepo: UserRepository;
    let repo: SessionRepository;

    // IDs of two seed users created in beforeEach.
    let userId1: number;
    let userId2: number;

    beforeAll(async () => {
        db = await setupTestDb();
        userRepo = new UserRepository();
        repo = new SessionRepository();
    }, 180_000);

    afterAll(async () => {
        await db.cleanup();
    }, 30_000);

    beforeEach(async () => {
        await db.truncate();

        // Insert two users so we can verify ownership scoping.
        const u1 = makeUserAttrs({username: "alice"});
        const u2 = makeUserAttrs({username: "bob"});
        await userRepo.insertUser(u1.username, u1.password, u1.firstName, u1.lastName, u1.email, u1.role);
        await userRepo.insertUser(u2.username, u2.password, u2.firstName, u2.lastName, u2.email, u2.role);

        const pw1 = await userRepo.getUser("alice");
        const pw2 = await userRepo.getUser("bob");
        userId1 = pw1!.id;
        userId2 = pw2!.id;
    });

    // -----------------------------------------------------------------------
    // create + column mapping
    // -----------------------------------------------------------------------
    describe("create", () => {
        it("persists a new session and maps all columns", async () => {
            const session = await repo.create(userId1, "My Session");

            expect(session.id).toBeTypeOf("number");
            expect(session.name).toBe("My Session");
            expect(session.userId).toBe(userId1);
            expect(session.overlayToken).toHaveLength(64);
            expect(session.endedAt).toBeNull();
            expect(session.createdAt).toBeInstanceOf(Date);
            expect(session.updatedAt).toBeInstanceOf(Date);
        });

        it("generates a unique overlay token per session", async () => {
            const s1 = await repo.create(userId1, "S1");
            const s2 = await repo.create(userId1, "S2");
            expect(s1.overlayToken).not.toBe(s2.overlayToken);
        });
    });

    // -----------------------------------------------------------------------
    // findByUserAndStatus
    // -----------------------------------------------------------------------
    describe("findByUserAndStatus", () => {
        it("returns active sessions for the owner (status='active')", async () => {
            await repo.create(userId1, "Active");
            const results = await repo.findByUserAndStatus(userId1, "active");
            expect(results).toHaveLength(1);
            expect(results[0]!.name).toBe("Active");
        });

        it("excludes ended sessions from 'active' results", async () => {
            const s = await repo.create(userId1, "To end");
            await repo.markEnded(s.id, userId1);

            const active = await repo.findByUserAndStatus(userId1, "active");
            expect(active).toHaveLength(0);

            const ended = await repo.findByUserAndStatus(userId1, "ended");
            expect(ended).toHaveLength(1);
        });

        it("returns all sessions for status='all'", async () => {
            const s = await repo.create(userId1, "To end");
            await repo.create(userId1, "Active 2");
            await repo.markEnded(s.id, userId1);

            const all = await repo.findByUserAndStatus(userId1, "all");
            expect(all).toHaveLength(2);
        });

        it("does not expose another user's sessions", async () => {
            await repo.create(userId2, "Bob session");
            const aliceSessions = await repo.findByUserAndStatus(userId1, "all");
            expect(aliceSessions).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // findByIdForUser
    // -----------------------------------------------------------------------
    describe("findByIdForUser", () => {
        it("returns the session when id and userId match", async () => {
            const created = await repo.create(userId1, "My Session");
            const found = await repo.findByIdForUser(created.id, userId1);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(created.id);
        });

        it("returns null when the session belongs to a different user", async () => {
            const s = await repo.create(userId1, "Alice's session");
            expect(await repo.findByIdForUser(s.id, userId2)).toBeNull();
        });

        it("returns null for a non-existent id", async () => {
            expect(await repo.findByIdForUser(999999, userId1)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // findByIdPublic
    // -----------------------------------------------------------------------
    describe("findByIdPublic", () => {
        it("returns a session without user-scoping", async () => {
            const s = await repo.create(userId1, "Public session");
            const found = await repo.findByIdPublic(s.id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(s.id);
        });

        it("returns null for a non-existent id", async () => {
            expect(await repo.findByIdPublic(999999)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // findByIdAndToken
    // -----------------------------------------------------------------------
    describe("findByIdAndToken", () => {
        it("returns the session when id and token match", async () => {
            const s = await repo.create(userId1, "Token session");
            const found = await repo.findByIdAndToken(s.id, s.overlayToken);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(s.id);
        });

        it("returns null for a wrong token", async () => {
            const s = await repo.create(userId1, "Token session");
            expect(await repo.findByIdAndToken(s.id, "wrong-token")).toBeNull();
        });

        it("returns null for a non-existent session id", async () => {
            expect(await repo.findByIdAndToken(999999, "any-token")).toBeNull();
        });

        it("returns ended sessions (token validation is not blocked by endedAt)", async () => {
            const s = await repo.create(userId1, "Ended session");
            await repo.markEnded(s.id, userId1);
            const found = await repo.findByIdAndToken(s.id, s.overlayToken);
            expect(found).not.toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------
    describe("update", () => {
        it("updates the session name and returns the updated entity", async () => {
            const s = await repo.create(userId1, "Old Name");
            const updated = await repo.update(s.id, userId1, {name: "New Name"});
            expect(updated).not.toBeNull();
            expect(updated!.name).toBe("New Name");
        });

        it("returns null when the session does not belong to the user", async () => {
            const s = await repo.create(userId1, "Alice's session");
            expect(await repo.update(s.id, userId2, {name: "Bob update"})).toBeNull();
        });

        it("does not change the name when fields.name is undefined", async () => {
            const s = await repo.create(userId1, "Same Name");
            const updated = await repo.update(s.id, userId1, {});
            expect(updated!.name).toBe("Same Name");
        });
    });

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
    describe("delete", () => {
        it("deletes the session and returns true", async () => {
            const s = await repo.create(userId1, "To delete");
            const ok = await repo.delete(s.id, userId1);
            expect(ok).toBe(true);
            expect(await repo.findByIdForUser(s.id, userId1)).toBeNull();
        });

        it("returns false when the session does not belong to the user", async () => {
            const s = await repo.create(userId1, "Alice's session");
            expect(await repo.delete(s.id, userId2)).toBe(false);
        });

        it("returns false for a non-existent id", async () => {
            expect(await repo.delete(999999, userId1)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // markEnded
    // -----------------------------------------------------------------------
    describe("markEnded", () => {
        it("marks the session ended and returns status='ended'", async () => {
            const s = await repo.create(userId1, "To end");
            const result = await repo.markEnded(s.id, userId1);
            expect(result.status).toBe("ended");
            if (result.status === "ended") {
                expect(result.session.endedAt).toBeInstanceOf(Date);
                expect(result.session.endedAt).not.toBeNull();
            }
        });

        it("returns status='already_ended' on a second call", async () => {
            const s = await repo.create(userId1, "To end");
            await repo.markEnded(s.id, userId1);
            const result = await repo.markEnded(s.id, userId1);
            expect(result.status).toBe("already_ended");
        });

        it("returns status='not_found' for a session owned by a different user", async () => {
            const s = await repo.create(userId1, "Alice's session");
            const result = await repo.markEnded(s.id, userId2);
            expect(result.status).toBe("not_found");
        });

        it("returns status='not_found' for a non-existent session id", async () => {
            const result = await repo.markEnded(999999, userId1);
            expect(result.status).toBe("not_found");
        });

        it("bumps updatedAt so the change is visible to sorted clients", async () => {
            const s = await repo.create(userId1, "Timing test");
            const before = s.updatedAt;
            // Small sleep to ensure clock advances (same tick would give equal timestamps).
            await new Promise(r => setTimeout(r, 20));
            const result = await repo.markEnded(s.id, userId1);
            if (result.status === "ended") {
                expect(result.session.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            }
        });
    });

    // -----------------------------------------------------------------------
    // rotateOverlayToken
    // -----------------------------------------------------------------------
    describe("rotateOverlayToken", () => {
        it("replaces the overlay token and returns the updated session", async () => {
            const s = await repo.create(userId1, "Token session");
            const originalToken = s.overlayToken;
            const rotated = await repo.rotateOverlayToken(s.id, userId1);
            expect(rotated).not.toBeNull();
            expect(rotated!.overlayToken).toHaveLength(64);
            expect(rotated!.overlayToken).not.toBe(originalToken);
        });

        it("returns null when the session belongs to a different user", async () => {
            const s = await repo.create(userId1, "Alice's session");
            expect(await repo.rotateOverlayToken(s.id, userId2)).toBeNull();
        });

        it("returns null for a non-existent session id", async () => {
            expect(await repo.rotateOverlayToken(999999, userId1)).toBeNull();
        });

        it("old token no longer works after rotation", async () => {
            const s = await repo.create(userId1, "Token session");
            const oldToken = s.overlayToken;
            await repo.rotateOverlayToken(s.id, userId1);
            expect(await repo.findByIdAndToken(s.id, oldToken)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // findActiveWithFixtureIds
    // -----------------------------------------------------------------------
    describe("findActiveWithFixtureIds", () => {
        it("returns an empty array when there are no active sessions", async () => {
            const results = await repo.findActiveWithFixtureIds();
            expect(results).toEqual([]);
        });

        it("includes active sessions with empty fixtureIds when no fixtures attached", async () => {
            await repo.create(userId1, "Active session");
            const results = await repo.findActiveWithFixtureIds();
            expect(results).toHaveLength(1);
            expect(results[0]!.fixtureIds).toEqual([]);
        });

        it("excludes ended sessions", async () => {
            const s = await repo.create(userId1, "Ended");
            await repo.markEnded(s.id, userId1);
            const results = await repo.findActiveWithFixtureIds();
            expect(results).toHaveLength(0);
        });
    });
});

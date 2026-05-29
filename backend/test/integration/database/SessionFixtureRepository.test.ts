/**
 * Integration tests for SessionFixtureRepository.
 *
 * Exercises entity↔column mappings, composite-PK inserts/reads,
 * attach/detach lifecycle, and the custom query methods for the SportMonks
 * poller.
 *
 * One container per file; truncate per test for isolation.
 */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {setupTestDb, type TestDb} from "../../helpers/postgres";
import {makeUserAttrs} from "../../helpers/factories";
import {UserRepository} from "../../../src/database/repositories/UserRepository";
import {SessionRepository} from "../../../src/database/repositories/SessionRepository";
import {SessionFixtureRepository} from "../../../src/database/repositories/SessionFixtureRepository";

describe("SessionFixtureRepository (integration)", () => {
    let db: TestDb;
    let userRepo: UserRepository;
    let sessionRepo: SessionRepository;
    let repo: SessionFixtureRepository;

    /** A pre-created active session owned by the seed user. */
    let sessionId: number;
    /** A second active session owned by the seed user. */
    let sessionId2: number;
    let userId: number;

    beforeAll(async () => {
        db = await setupTestDb();
        userRepo = new UserRepository();
        sessionRepo = new SessionRepository();
        repo = new SessionFixtureRepository();
    }, 180_000);

    afterAll(async () => {
        await db.cleanup();
    }, 30_000);

    beforeEach(async () => {
        await db.truncate();

        // Seed one user and two sessions.
        const u = makeUserAttrs({username: "test_user"});
        await userRepo.insertUser(u.username, u.password, u.firstName, u.lastName, u.email, u.role);
        const pw = await userRepo.getUser("test_user");
        userId = pw!.id;

        const s1 = await sessionRepo.create(userId, "Session A");
        const s2 = await sessionRepo.create(userId, "Session B");
        sessionId = s1.id;
        sessionId2 = s2.id;
    });

    // -----------------------------------------------------------------------
    // attach + findOne
    // -----------------------------------------------------------------------
    describe("attach", () => {
        it("creates a session_fixture row and returns the entity", async () => {
            const attached = await repo.attach(sessionId, 1001);

            expect(attached.sessionId).toBe(sessionId);
            expect(attached.sportmonksFixtureId).toBe(1001);
            expect(attached.createdAt).toBeInstanceOf(Date);
        });

        it("maps the bigint column as a JavaScript number", async () => {
            const attached = await repo.attach(sessionId, 99999);
            expect(typeof attached.sportmonksFixtureId).toBe("number");
        });
    });

    describe("findOne", () => {
        it("returns the row when the (sessionId, sportmonksFixtureId) pair exists", async () => {
            await repo.attach(sessionId, 2001);
            const found = await repo.findOne(sessionId, 2001);
            expect(found).not.toBeNull();
            expect(found!.sportmonksFixtureId).toBe(2001);
        });

        it("returns null when the pair does not exist", async () => {
            expect(await repo.findOne(sessionId, 9999)).toBeNull();
        });

        it("returns null when the session_id does not match", async () => {
            await repo.attach(sessionId, 2002);
            expect(await repo.findOne(sessionId2, 2002)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // findBySession
    // -----------------------------------------------------------------------
    describe("findBySession", () => {
        it("returns all fixtures attached to a session, ordered by sportmonksFixtureId ASC", async () => {
            await repo.attach(sessionId, 300);
            await repo.attach(sessionId, 100);
            await repo.attach(sessionId, 200);

            const results = await repo.findBySession(sessionId);

            expect(results).toHaveLength(3);
            expect(results.map(r => r.sportmonksFixtureId)).toEqual([100, 200, 300]);
        });

        it("returns an empty array for a session with no attached fixtures", async () => {
            const results = await repo.findBySession(sessionId);
            expect(results).toEqual([]);
        });

        it("does not include fixtures from another session", async () => {
            await repo.attach(sessionId, 400);
            await repo.attach(sessionId2, 401);

            const results = await repo.findBySession(sessionId);
            expect(results).toHaveLength(1);
            expect(results[0]!.sessionId).toBe(sessionId);
        });
    });

    // -----------------------------------------------------------------------
    // detach
    // -----------------------------------------------------------------------
    describe("detach", () => {
        it("removes the row and returns true", async () => {
            await repo.attach(sessionId, 5001);
            const ok = await repo.detach(sessionId, 5001);
            expect(ok).toBe(true);
            expect(await repo.findOne(sessionId, 5001)).toBeNull();
        });

        it("returns false when the row does not exist", async () => {
            expect(await repo.detach(sessionId, 9999)).toBe(false);
        });

        it("returns false when the sessionId does not match", async () => {
            await repo.attach(sessionId, 5002);
            expect(await repo.detach(sessionId2, 5002)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // findSportmonksFixtureIdsBySessionId
    // -----------------------------------------------------------------------
    describe("findSportmonksFixtureIdsBySessionId", () => {
        it("returns fixture IDs for a session, ascending", async () => {
            await repo.attach(sessionId, 700);
            await repo.attach(sessionId, 500);
            await repo.attach(sessionId, 600);

            const ids = await repo.findSportmonksFixtureIdsBySessionId(sessionId);
            expect(ids).toEqual([500, 600, 700]);
        });

        it("returns an empty array for a session with no fixtures", async () => {
            const ids = await repo.findSportmonksFixtureIdsBySessionId(sessionId);
            expect(ids).toEqual([]);
        });

        it("does not include fixture IDs from a different session", async () => {
            await repo.attach(sessionId, 800);
            await repo.attach(sessionId2, 801);

            const ids = await repo.findSportmonksFixtureIdsBySessionId(sessionId);
            expect(ids).toEqual([800]);
        });

        it("returns numeric values (not bigint strings)", async () => {
            await repo.attach(sessionId, 9876);
            const ids = await repo.findSportmonksFixtureIdsBySessionId(sessionId);
            expect(ids.every(id => typeof id === "number")).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // findSportmonksFixtureIdsForActiveSessions
    // -----------------------------------------------------------------------
    describe("findSportmonksFixtureIdsForActiveSessions", () => {
        it("returns an empty array when there are no active sessions", async () => {
            // End all sessions created in beforeEach.
            await sessionRepo.markEnded(sessionId, userId);
            await sessionRepo.markEnded(sessionId2, userId);

            const ids = await repo.findSportmonksFixtureIdsForActiveSessions();
            expect(ids).toEqual([]);
        });

        it("returns fixture IDs only from active sessions", async () => {
            await repo.attach(sessionId, 1001);
            await repo.attach(sessionId, 1002);
            await repo.attach(sessionId2, 1003);
            // End session2 — its fixture should disappear from results.
            await sessionRepo.markEnded(sessionId2, userId);

            const ids = await repo.findSportmonksFixtureIdsForActiveSessions();
            expect(ids.sort()).toEqual([1001, 1002].sort());
        });

        it("deduplicates fixture IDs shared across active sessions", async () => {
            await repo.attach(sessionId, 2000);
            await repo.attach(sessionId2, 2000); // same fixture id in both sessions

            const ids = await repo.findSportmonksFixtureIdsForActiveSessions();
            // Should appear only once due to DISTINCT
            expect(ids.filter(id => id === 2000)).toHaveLength(1);
        });

        it("returns numeric values (not bigint strings)", async () => {
            await repo.attach(sessionId, 3000);
            const ids = await repo.findSportmonksFixtureIdsForActiveSessions();
            expect(ids.every(id => typeof id === "number")).toBe(true);
        });
    });
});

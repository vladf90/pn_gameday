/**
 * Unit tests for SessionController.
 *
 * All external dependencies (repositories, LiveSnapshotStore, OverlayEventBus)
 * are replaced with plain vi.fn() stubs. No I/O is performed.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

import {
    SessionController,
    GetSessionValidator,
    CreateSessionValidator,
} from "../../../src/controller/SessionController";
import type {SessionRepository} from "../../../src/database/repositories/SessionRepository";
import type {SessionFixtureRepository} from "../../../src/database/repositories/SessionFixtureRepository";
import {OverlayEventBus} from "../../../src/sportmonks/OverlayEventBus";
import type {UserAuth} from "../../../src/router/UserAuthRouter";
import type {Session} from "../../../src/database/entities/Session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 1,
        name: "Test Session",
        userId: 10,
        overlayToken: "deadbeef".repeat(8),
        endedAt: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
        user: undefined as unknown as Session["user"],
        ...overrides,
    };
}

const auth: UserAuth = {
    id: 10,
    username: "alice@example.com",
    role: "user",
    permissions: ["session:read", "session:create", "session:update", "session:delete"],
};

// ---------------------------------------------------------------------------
// Factory for a controller + stubs
// ---------------------------------------------------------------------------

function makeController(overrides: {
    sessionRepo?: Partial<SessionRepository>;
    fixtureRepo?: Partial<SessionFixtureRepository>;
    overlayBaseUrl?: string;
} = {}) {
    const sessionRepo: SessionRepository = {
        findByUserAndStatus: vi.fn(),
        findByIdForUser: vi.fn(),
        findByIdPublic: vi.fn(),
        findByIdAndToken: vi.fn(),
        findActiveWithFixtureIds: vi.fn(),
        create: vi.fn(),
        rotateOverlayToken: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        markEnded: vi.fn(),
        ...overrides.sessionRepo,
    } as unknown as SessionRepository;

    const fixtureRepo: SessionFixtureRepository = {
        findBySession: vi.fn(),
        findOne: vi.fn(),
        attach: vi.fn(),
        detach: vi.fn(),
        findSportmonksFixtureIdsBySessionId: vi.fn(),
        findSportmonksFixtureIdsForActiveSessions: vi.fn(),
        ...overrides.fixtureRepo,
    } as unknown as SessionFixtureRepository;

    const overlayEventBus = new OverlayEventBus();
    const controller = new SessionController(
        sessionRepo,
        fixtureRepo,
        undefined, // no live snapshot store
        overrides.overlayBaseUrl,
        overlayEventBus,
    );

    return {controller, sessionRepo, fixtureRepo, overlayEventBus};
}

// ---------------------------------------------------------------------------
// getAll
// ---------------------------------------------------------------------------
describe("SessionController.getAll", () => {
    it("returns session summaries filtered by the default active status", async () => {
        const session = makeSession();
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByUserAndStatus).mockResolvedValue([session]);

        const result = await controller.getAll(auth, {});

        expect(sessionRepo.findByUserAndStatus).toHaveBeenCalledWith(auth.id, "active");
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({id: 1, name: "Test Session"});
    });

    it("passes 'ended' status filter through", async () => {
        const ended = makeSession({endedAt: new Date("2024-06-01")});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByUserAndStatus).mockResolvedValue([ended]);

        const result = await controller.getAll(auth, {status: "ended"});

        expect(sessionRepo.findByUserAndStatus).toHaveBeenCalledWith(auth.id, "ended");
        expect(result[0]?.endedAt).toBeInstanceOf(Date);
    });

    it("throws 400 for an unrecognised status filter", async () => {
        const {controller} = makeController();
        await expect(controller.getAll(auth, {status: "garbage"})).rejects.toMatchObject({
            name: "ServiceError",
            message: expect.stringContaining("Invalid status filter"),
        });
    });

    it("treats an empty-string status as 'active'", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByUserAndStatus).mockResolvedValue([]);
        await controller.getAll(auth, {status: ""});
        expect(sessionRepo.findByUserAndStatus).toHaveBeenCalledWith(auth.id, "active");
    });

    it("builds an absolute overlay URL when publicOverlayBaseUrl is set", async () => {
        const session = makeSession({overlayToken: "abc123"});
        const {controller, sessionRepo} = makeController({overlayBaseUrl: "https://example.com"});
        vi.mocked(sessionRepo.findByUserAndStatus).mockResolvedValue([session]);

        const [summary] = await controller.getAll(auth, {});
        expect(summary?.overlayUrl).toMatch(/^https:\/\/example\.com\/overlay\/1\?token=/);
    });

    it("builds a root-relative overlay URL when publicOverlayBaseUrl is not set", async () => {
        const session = makeSession({overlayToken: "abc123"});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByUserAndStatus).mockResolvedValue([session]);

        const [summary] = await controller.getAll(auth, {});
        expect(summary?.overlayUrl).toMatch(/^\/overlay\/1\?token=/);
    });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------
describe("SessionController.get", () => {
    it("returns SessionDetail with fixture ids on success", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findBySession).mockResolvedValue([
            {sessionId: 1, sportmonksFixtureId: 99, createdAt: new Date(), session: undefined as never},
        ]);

        const result = await controller.get(auth, {id: 1});

        expect(result.id).toBe(1);
        expect(result.fixtureIds).toEqual([99]);
    });

    it("throws 404 when the session does not exist for this user", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(null);

        await expect(controller.get(auth, {id: 999})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });
});

// ---------------------------------------------------------------------------
// getLive
// ---------------------------------------------------------------------------
describe("SessionController.getLive", () => {
    it("returns empty fixtures when liveSnapshotStore is undefined", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findSportmonksFixtureIdsBySessionId).mockResolvedValue([42, 43]);

        const result = await controller.getLive(auth, {id: 1});

        expect(result.sessionId).toBe(1);
        expect(result.fixtures).toEqual([]);
        expect(result.missingFixtureIds).toEqual([42, 43]);
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(null);

        await expect(controller.getLive(auth, {id: 999})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe("SessionController.create", () => {
    it("creates a session and returns a summary", async () => {
        const session = makeSession({name: "New Session"});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.create).mockResolvedValue(session);

        const result = await controller.create(auth, {name: "New Session"});

        expect(sessionRepo.create).toHaveBeenCalledWith(auth.id, "New Session");
        expect(result.name).toBe("New Session");
    });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe("SessionController.update", () => {
    it("updates and returns the session summary", async () => {
        const session = makeSession({name: "Updated"});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.update).mockResolvedValue(session);

        const result = await controller.update(auth, {id: 1, name: "Updated"});

        expect(sessionRepo.update).toHaveBeenCalledWith(1, auth.id, {name: "Updated"});
        expect(result.name).toBe("Updated");
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.update).mockResolvedValue(null);

        await expect(controller.update(auth, {id: 99, name: "X"})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
describe("SessionController.delete", () => {
    it("returns { id } on successful delete", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.delete).mockResolvedValue(true);

        const result = await controller.delete(auth, {id: 1});

        expect(result).toEqual({id: 1});
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.delete).mockResolvedValue(false);

        await expect(controller.delete(auth, {id: 99})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });
});

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------
describe("SessionController.end", () => {
    it("returns session summary on successful end", async () => {
        const ended = makeSession({endedAt: new Date("2024-06-01")});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.markEnded).mockResolvedValue({status: "ended", session: ended});

        const result = await controller.end(auth, {id: 1});

        expect(result.endedAt).toBeInstanceOf(Date);
    });

    it("throws 404 when status is not_found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.markEnded).mockResolvedValue({status: "not_found"});

        await expect(controller.end(auth, {id: 99})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });

    it("throws 409 when session already ended", async () => {
        const ended = makeSession({endedAt: new Date()});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.markEnded).mockResolvedValue({status: "already_ended", session: ended});

        await expect(controller.end(auth, {id: 1})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session already ended",
        });
    });
});

// ---------------------------------------------------------------------------
// rotateOverlayToken
// ---------------------------------------------------------------------------
describe("SessionController.rotateOverlayToken", () => {
    it("returns updated summary with new token in overlay URL", async () => {
        const rotated = makeSession({overlayToken: "newtoken".padEnd(64, "0")});
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.rotateOverlayToken).mockResolvedValue(rotated);

        const result = await controller.rotateOverlayToken(auth, {id: 1});

        expect(sessionRepo.rotateOverlayToken).toHaveBeenCalledWith(1, auth.id);
        expect(result.overlayUrl).toContain("token=");
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.rotateOverlayToken).mockResolvedValue(null);

        await expect(controller.rotateOverlayToken(auth, {id: 99})).rejects.toMatchObject({
            name: "ServiceError",
            message: "Session not found",
        });
    });
});

// ---------------------------------------------------------------------------
// publicOverlay
// ---------------------------------------------------------------------------
describe("SessionController.publicOverlay", () => {
    it("returns overlay payload when token matches", async () => {
        const session = makeSession({overlayToken: "validtoken"});
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdAndToken).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findSportmonksFixtureIdsBySessionId).mockResolvedValue([]);

        const result = await controller.publicOverlay(undefined as void, {id: 1, token: "validtoken"});

        expect(result.sessionId).toBe(1);
        expect(result.name).toBe("Test Session");
        expect(result.fixtures).toEqual([]);
    });

    it("throws 404 when token is missing", async () => {
        const {controller} = makeController();
        await expect(
            controller.publicOverlay(undefined as void, {id: 1, token: undefined}),
        ).rejects.toMatchObject({name: "ServiceError", message: "Session not found"});
    });

    it("throws 404 when session+token combo not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByIdAndToken).mockResolvedValue(null);

        await expect(
            controller.publicOverlay(undefined as void, {id: 1, token: "wrongtoken"}),
        ).rejects.toMatchObject({name: "ServiceError", message: "Session not found"});
    });
});

// ---------------------------------------------------------------------------
// attachFixture
// ---------------------------------------------------------------------------
describe("SessionController.attachFixture", () => {
    it("attaches a fixture and returns sessionId + sportmonksFixtureId", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findOne).mockResolvedValue(null);
        vi.mocked(fixtureRepo.attach).mockResolvedValue({
            sessionId: 1,
            sportmonksFixtureId: 77,
            createdAt: new Date(),
            session: undefined as never,
        });

        const result = await controller.attachFixture(auth, {id: 1, sportmonksFixtureId: 77});

        expect(result).toEqual({sessionId: 1, sportmonksFixtureId: 77});
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(null);

        await expect(controller.attachFixture(auth, {id: 99, sportmonksFixtureId: 1})).rejects.toMatchObject({
            message: "Session not found",
        });
    });

    it("throws 409 when fixture already attached", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findOne).mockResolvedValue({
            sessionId: 1,
            sportmonksFixtureId: 77,
            createdAt: new Date(),
            session: undefined as never,
        });

        await expect(controller.attachFixture(auth, {id: 1, sportmonksFixtureId: 77})).rejects.toMatchObject({
            message: "Fixture already attached to session",
        });
    });
});

// ---------------------------------------------------------------------------
// detachFixture
// ---------------------------------------------------------------------------
describe("SessionController.detachFixture", () => {
    it("detaches a fixture and returns the ids", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.detach).mockResolvedValue(true);

        const result = await controller.detachFixture(auth, {id: 1, fixtureId: 77});

        expect(result).toEqual({sessionId: 1, sportmonksFixtureId: 77});
    });

    it("throws 404 when session not found", async () => {
        const {controller, sessionRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(null);

        await expect(controller.detachFixture(auth, {id: 99, fixtureId: 1})).rejects.toMatchObject({
            message: "Session not found",
        });
    });

    it("throws 404 when fixture not attached", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo} = makeController();
        vi.mocked(sessionRepo.findByIdForUser).mockResolvedValue(session);
        vi.mocked(fixtureRepo.detach).mockResolvedValue(false);

        await expect(controller.detachFixture(auth, {id: 1, fixtureId: 99})).rejects.toMatchObject({
            message: "Fixture not attached to session",
        });
    });
});

// ---------------------------------------------------------------------------
// broadcastOverlayUpdates
// ---------------------------------------------------------------------------
describe("SessionController.broadcastOverlayUpdates", () => {
    it("does nothing when no sessions are subscribed", async () => {
        const {controller, sessionRepo} = makeController();
        // Should not throw and should not call any repo method
        await controller.broadcastOverlayUpdates();
        expect(sessionRepo.findByIdPublic).not.toHaveBeenCalled();
    });

    it("broadcasts synthetic ended frame when session is deleted mid-stream", async () => {
        const {controller, sessionRepo, overlayEventBus} = makeController();

        const writes: unknown[] = [];
        // Subscribe a writer for session 1
        overlayEventBus.subscribe(1, (payload) => {
            writes.push(payload);
            return true;
        });

        // Session no longer exists
        vi.mocked(sessionRepo.findByIdPublic).mockResolvedValue(null);

        await controller.broadcastOverlayUpdates();

        expect(writes).toHaveLength(1);
        expect((writes[0] as {endedAt: Date}).endedAt).toBeInstanceOf(Date);
    });

    it("broadcasts payload for active sessions", async () => {
        const session = makeSession();
        const {controller, sessionRepo, fixtureRepo, overlayEventBus} = makeController();

        const writes: unknown[] = [];
        overlayEventBus.subscribe(1, (payload) => {
            writes.push(payload);
            return true;
        });

        vi.mocked(sessionRepo.findByIdPublic).mockResolvedValue(session);
        vi.mocked(fixtureRepo.findSportmonksFixtureIdsBySessionId).mockResolvedValue([]);

        await controller.broadcastOverlayUpdates();

        expect(writes).toHaveLength(1);
        expect((writes[0] as {sessionId: number}).sessionId).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Validators (smoke-level checks for the shapes exported by this module)
// ---------------------------------------------------------------------------
describe("SessionController validators", () => {
    it("GetSessionValidator rejects missing id", () => {
        const v = new GetSessionValidator();
        expect(v.validate({id: "not-a-number-string-abc"})).not.toBeNull();
    });

    it("CreateSessionValidator rejects missing name", () => {
        const v = new CreateSessionValidator();
        expect(v.validate({name: 123})).not.toBeNull();
    });

    it("CreateSessionValidator accepts valid name", () => {
        const v = new CreateSessionValidator();
        expect(v.validate({name: "My Session"})).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
beforeEach(() => {
    vi.clearAllMocks();
});

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../../src/sportmonks/metrics", () => ({
    sportmonksLiveFixturesInMemory: {set: vi.fn()},
}));

vi.mock("../../../src/Logger", () => ({
    Logger: vi.fn().mockImplementation(() => ({
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    })),
}));

import {SessionAutoCloser} from "../../../src/sportmonks/SessionAutoCloser";
import {LiveSnapshotStore} from "../../../src/sportmonks/LiveSnapshotStore";
import type {SessionRepository} from "../../../src/database/repositories/SessionRepository";
import type {LiveFixture} from "../../../src/sportmonks/types";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

type ActiveSession = {sessionId: number; userId: number; fixtureIds: number[]};

function makeSessionRepo(sessions: ActiveSession[] = [], markEndedResult: {status: string} = {status: "ended"}): SessionRepository {
    return {
        findActiveWithFixtureIds: vi.fn().mockResolvedValue(sessions),
        markEnded: vi.fn().mockResolvedValue(markEndedResult),
    } as unknown as SessionRepository;
}

function makeFixture(id: number, shortName: string): LiveFixture {
    return {id, state: {short_name: shortName}};
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionAutoCloser", () => {
    let store: LiveSnapshotStore;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        store = new LiveSnapshotStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // Lifecycle: start / stop
    // -----------------------------------------------------------------------

    describe("start() / stop()", () => {
        it("stop() before start() resolves immediately", async () => {
            const closer = new SessionAutoCloser(makeSessionRepo(), store, {intervalMs: 1000});
            await expect(closer.stop()).resolves.toBeUndefined();
        });

        it("start() is idempotent — second call is a no-op", async () => {
            const repo = makeSessionRepo([]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 500});

            closer.start();
            closer.start();

            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();

            expect(vi.mocked(repo.findActiveWithFixtureIds)).toHaveBeenCalledTimes(1);

            await closer.stop();
        });

        it("stop() prevents further ticks", async () => {
            const repo = makeSessionRepo([]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 500});

            closer.start();
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();

            const callsAfterFirst = vi.mocked(repo.findActiveWithFixtureIds).mock.calls.length;

            await closer.stop();

            await vi.advanceTimersByTimeAsync(1000);
            await flushPromises();

            expect(vi.mocked(repo.findActiveWithFixtureIds)).toHaveBeenCalledTimes(callsAfterFirst);
        });
    });

    // -----------------------------------------------------------------------
    // runTick() — shouldEnd predicate
    // -----------------------------------------------------------------------

    describe("runTick() — session ending logic", () => {
        it("does NOT end a session with no fixture IDs", async () => {
            const repo = makeSessionRepo([{sessionId: 1, userId: 10, fixtureIds: []}]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await closer.runTick();

            expect(vi.mocked(repo.markEnded)).not.toHaveBeenCalled();
        });

        it("does NOT end a session when a snapshot is missing for one of its fixtures", async () => {
            // Only fixture 1 is in the store; fixture 2 is missing
            store.replaceMany([makeFixture(1, "FT")]);

            const repo = makeSessionRepo([{sessionId: 1, userId: 10, fixtureIds: [1, 2]}]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await closer.runTick();

            expect(vi.mocked(repo.markEnded)).not.toHaveBeenCalled();
        });

        it("does NOT end a session when at least one fixture is in a non-terminal state", async () => {
            store.replaceMany([makeFixture(1, "FT"), makeFixture(2, "INPLAY_1ST_HALF")]);

            const repo = makeSessionRepo([{sessionId: 1, userId: 10, fixtureIds: [1, 2]}]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await closer.runTick();

            expect(vi.mocked(repo.markEnded)).not.toHaveBeenCalled();
        });

        it("ends a session when all fixtures are in terminal states", async () => {
            store.replaceMany([makeFixture(1, "FT"), makeFixture(2, "AET")]);

            const repo = makeSessionRepo([{sessionId: 1, userId: 10, fixtureIds: [1, 2]}]);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await closer.runTick();

            expect(vi.mocked(repo.markEnded)).toHaveBeenCalledWith(1, 10);
        });

        it("ends only sessions whose fixtures are all terminal (mixed scenario)", async () => {
            store.replaceMany([
                makeFixture(10, "FT"),
                makeFixture(20, "NS"),    // non-terminal → session 2 stays open
                makeFixture(30, "CANCL"),
            ]);

            const sessions: ActiveSession[] = [
                {sessionId: 1, userId: 100, fixtureIds: [10]},       // should end
                {sessionId: 2, userId: 200, fixtureIds: [20]},       // should NOT end
                {sessionId: 3, userId: 300, fixtureIds: [10, 30]},   // should end
            ];

            const repo = makeSessionRepo(sessions);
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await closer.runTick();

            expect(vi.mocked(repo.markEnded)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(repo.markEnded)).toHaveBeenCalledWith(1, 100);
            expect(vi.mocked(repo.markEnded)).toHaveBeenCalledWith(3, 300);
            expect(vi.mocked(repo.markEnded)).not.toHaveBeenCalledWith(2, 200);
        });

        it("handles the 'already_ended' markEnded result gracefully (no double-count)", async () => {
            store.replaceMany([makeFixture(1, "FT")]);
            const repo = makeSessionRepo(
                [{sessionId: 1, userId: 10, fixtureIds: [1]}],
                {status: "already_ended"},
            );
            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await expect(closer.runTick()).resolves.toBeUndefined();
        });

        it("handles all documented terminal states for a single-fixture session", async () => {
            const terminalStates = ["FT", "AET", "FT_PEN", "CANCL", "POSTP", "ABAN", "AWARDED", "WO"];

            for (const state of terminalStates) {
                vi.clearAllMocks();
                const freshStore = new LiveSnapshotStore();
                freshStore.replaceMany([makeFixture(99, state)]);

                const repo = makeSessionRepo([{sessionId: 1, userId: 10, fixtureIds: [99]}]);
                const closer = new SessionAutoCloser(repo, freshStore, {intervalMs: 1000});

                await closer.runTick();

                expect(vi.mocked(repo.markEnded)).toHaveBeenCalledWith(1, 10);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Error resilience
    // -----------------------------------------------------------------------

    describe("error handling", () => {
        it("catches DB errors and continues without throwing", async () => {
            const repo = {
                findActiveWithFixtureIds: vi.fn().mockRejectedValue(new Error("DB connection lost")),
                markEnded: vi.fn(),
            } as unknown as SessionRepository;

            const closer = new SessionAutoCloser(repo, store, {intervalMs: 1000});

            await expect(closer.runTick()).resolves.toBeUndefined();
        });

        it("continues polling after a tick throws", async () => {
            const repo = {
                findActiveWithFixtureIds: vi
                    .fn()
                    .mockRejectedValueOnce(new Error("transient error"))
                    .mockResolvedValue([]),
                markEnded: vi.fn(),
            } as unknown as SessionRepository;

            const closer = new SessionAutoCloser(repo, store, {intervalMs: 500});
            closer.start();

            // First tick — throws
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();

            // Second tick — succeeds
            await vi.advanceTimersByTimeAsync(500);
            await flushPromises();

            expect(vi.mocked(repo.findActiveWithFixtureIds)).toHaveBeenCalledTimes(2);

            await closer.stop();
        });
    });
});

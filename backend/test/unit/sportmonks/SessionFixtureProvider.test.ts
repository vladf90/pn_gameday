import {describe, expect, it, vi} from "vitest";
import {SessionFixtureProvider} from "../../../src/sportmonks/SessionFixtureProvider";
import type {SessionFixtureRepository} from "../../../src/database/repositories/SessionFixtureRepository";

// Minimal stub — only the method called by SessionFixtureProvider is needed.
function makeRepo(ids: number[]): Pick<SessionFixtureRepository, "findSportmonksFixtureIdsForActiveSessions"> {
    return {
        findSportmonksFixtureIdsForActiveSessions: vi.fn().mockResolvedValue(ids),
    };
}

describe("SessionFixtureProvider", () => {
    let provider: SessionFixtureProvider;

    describe("getActiveFixtureIds()", () => {
        it("returns an empty array when the repo returns no IDs", async () => {
            provider = new SessionFixtureProvider(makeRepo([]) as unknown as SessionFixtureRepository);
            await expect(provider.getActiveFixtureIds()).resolves.toEqual([]);
        });

        it("returns IDs sorted ascending", async () => {
            provider = new SessionFixtureProvider(
                makeRepo([5, 1, 3]) as unknown as SessionFixtureRepository,
            );
            await expect(provider.getActiveFixtureIds()).resolves.toEqual([1, 3, 5]);
        });

        it("deduplicates IDs returned by the repo", async () => {
            provider = new SessionFixtureProvider(
                makeRepo([2, 2, 3, 2]) as unknown as SessionFixtureRepository,
            );
            await expect(provider.getActiveFixtureIds()).resolves.toEqual([2, 3]);
        });

        it("delegates to the repo's findSportmonksFixtureIdsForActiveSessions", async () => {
            const repo = makeRepo([10]) as unknown as SessionFixtureRepository;
            provider = new SessionFixtureProvider(repo);
            await provider.getActiveFixtureIds();
            expect(
                (repo as ReturnType<typeof makeRepo>).findSportmonksFixtureIdsForActiveSessions,
            ).toHaveBeenCalledOnce();
        });

        it("propagates errors thrown by the repo", async () => {
            const repo = {
                findSportmonksFixtureIdsForActiveSessions: vi.fn().mockRejectedValue(new Error("db error")),
            } as unknown as SessionFixtureRepository;
            provider = new SessionFixtureProvider(repo);
            await expect(provider.getActiveFixtureIds()).rejects.toThrow("db error");
        });
    });
});

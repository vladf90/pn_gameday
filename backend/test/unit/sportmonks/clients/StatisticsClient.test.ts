import {beforeEach, describe, expect, it, vi} from "vitest";
import {StatisticsClient} from "../../../../src/sportmonks/clients/StatisticsClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("StatisticsClient", () => {
    let http: SportmonksHttpClient;
    let client: StatisticsClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new StatisticsClient(http);
    });

    const entity = {entity: "Statistic"};

    describe("getSeasonStatisticsByParticipant()", () => {
        it("calls GET /statistics/seasons/{participant}/{id}", async () => {
            await client.getSeasonStatisticsByParticipant("players", 42);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/statistics/seasons/players/42",
                undefined,
                entity,
            );
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getSeasonStatisticsByParticipant("teams", 7, {includes: ["team", "season"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/statistics/seasons/teams/7",
                {include: "team;season"},
                entity,
            );
        });
    });

    describe("getStageStatistics()", () => {
        it("calls GET /statistics/stages/{stageId}", async () => {
            await client.getStageStatistics(99);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/statistics/stages/99",
                undefined,
                entity,
            );
        });
    });

    describe("getRoundStatistics()", () => {
        it("calls GET /statistics/rounds/{roundId}", async () => {
            await client.getRoundStatistics(5);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/statistics/rounds/5",
                undefined,
                entity,
            );
        });
    });
});

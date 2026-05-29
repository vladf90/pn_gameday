import {beforeEach, describe, expect, it, vi} from "vitest";
import {TopscorersClient} from "../../../../src/sportmonks/clients/TopscorersClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("TopscorersClient", () => {
    let http: SportmonksHttpClient;
    let client: TopscorersClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new TopscorersClient(http);
    });

    const entity = {entity: "Topscorer"};

    describe("getBySeason()", () => {
        it("calls GET /topscorers/seasons/{seasonId}", async () => {
            await client.getBySeason(2024);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/topscorers/seasons/2024",
                undefined,
                entity,
            );
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getBySeason(2024, {includes: ["player", "team"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/topscorers/seasons/2024",
                {include: "player;team"},
                entity,
            );
        });
    });

    describe("getByStage()", () => {
        it("calls GET /topscorers/stages/{stageId}", async () => {
            await client.getByStage(99);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/topscorers/stages/99",
                undefined,
                entity,
            );
        });
    });
});

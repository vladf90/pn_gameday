import {beforeEach, describe, expect, it, vi} from "vitest";
import {SeasonsClient} from "../../../../src/sportmonks/clients/SeasonsClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("SeasonsClient", () => {
    let http: SportmonksHttpClient;
    let client: SeasonsClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new SeasonsClient(http);
    });

    const entity = {entity: "Season"};

    describe("getAll()", () => {
        it("calls GET /seasons with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/seasons", undefined, entity);
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getAll({includes: ["league", "teams"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/seasons",
                {include: "league;teams"},
                entity,
            );
        });
    });

    describe("getById()", () => {
        it("calls GET /seasons/{id}", async () => {
            await client.getById(2024);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/seasons/2024", undefined, entity);
        });
    });

    describe("search()", () => {
        it("calls GET /seasons/search/{name} with URL-encoded name", async () => {
            await client.search("2023 2024");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/seasons/search/2023%202024",
                undefined,
                entity,
            );
        });
    });
});

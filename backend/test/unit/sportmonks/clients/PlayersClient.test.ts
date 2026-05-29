import {beforeEach, describe, expect, it, vi} from "vitest";
import {PlayersClient} from "../../../../src/sportmonks/clients/PlayersClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("PlayersClient", () => {
    let http: SportmonksHttpClient;
    let client: PlayersClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new PlayersClient(http);
    });

    const entity = {entity: "Player"};

    describe("getAll()", () => {
        it("calls GET /players with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/players", undefined, entity);
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getAll({includes: ["teams", "statistics"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/players",
                {include: "teams;statistics"},
                entity,
            );
        });
    });

    describe("getById()", () => {
        it("calls GET /players/{id}", async () => {
            await client.getById(42);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/players/42", undefined, entity);
        });
    });

    describe("getByCountry()", () => {
        it("calls GET /players/countries/{countryId}", async () => {
            await client.getByCountry(11);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/players/countries/11",
                undefined,
                entity,
            );
        });
    });

    describe("search()", () => {
        it("calls GET /players/search/{name} with URL-encoded name", async () => {
            await client.search("Cristiano Ronaldo");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/players/search/Cristiano%20Ronaldo",
                undefined,
                entity,
            );
        });
    });

    describe("getLatest()", () => {
        it("calls GET /players/latest", async () => {
            await client.getLatest();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/players/latest", undefined, entity);
        });
    });
});

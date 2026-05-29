import {beforeEach, describe, expect, it, vi} from "vitest";
import {TeamsClient} from "../../../../src/sportmonks/clients/TeamsClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("TeamsClient", () => {
    let http: SportmonksHttpClient;
    let client: TeamsClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new TeamsClient(http);
    });

    const entity = {entity: "Team"};

    describe("getAll()", () => {
        it("calls GET /teams with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/teams", undefined, entity);
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getAll({includes: ["players", "venue"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/teams",
                {include: "players;venue"},
                entity,
            );
        });
    });

    describe("getById()", () => {
        it("calls GET /teams/{id}", async () => {
            await client.getById(42);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/teams/42", undefined, entity);
        });
    });

    describe("getByCountry()", () => {
        it("calls GET /teams/countries/{countryId}", async () => {
            await client.getByCountry(11);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/teams/countries/11",
                undefined,
                entity,
            );
        });
    });

    describe("getBySeason()", () => {
        it("calls GET /teams/seasons/{seasonId}", async () => {
            await client.getBySeason(2024);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/teams/seasons/2024",
                undefined,
                entity,
            );
        });
    });

    describe("search()", () => {
        it("calls GET /teams/search/{name} with URL-encoded name", async () => {
            await client.search("Manchester United");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/teams/search/Manchester%20United",
                undefined,
                entity,
            );
        });
    });
});

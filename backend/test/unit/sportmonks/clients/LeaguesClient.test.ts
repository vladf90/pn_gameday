import {beforeEach, describe, expect, it, vi} from "vitest";
import {LeaguesClient} from "../../../../src/sportmonks/clients/LeaguesClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("LeaguesClient", () => {
    let http: SportmonksHttpClient;
    let client: LeaguesClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new LeaguesClient(http);
    });

    const entity = {entity: "League"};

    describe("getAll()", () => {
        it("calls GET /leagues with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/leagues", undefined, entity);
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getAll({includes: ["country", "seasons"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/leagues",
                {include: "country;seasons"},
                entity,
            );
        });
    });

    describe("getById()", () => {
        it("calls GET /leagues/{id}", async () => {
            await client.getById(42);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/leagues/42", undefined, entity);
        });
    });

    describe("getLive()", () => {
        it("calls GET /leagues/live", async () => {
            await client.getLive();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/leagues/live", undefined, entity);
        });
    });

    describe("getByDateRange()", () => {
        it("calls GET /leagues/between/{start}/{end}", async () => {
            await client.getByDateRange("2024-06-01", "2024-06-30");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/leagues/between/2024-06-01/2024-06-30",
                undefined,
                entity,
            );
        });
    });

    describe("getByCountry()", () => {
        it("calls GET /leagues/countries/{countryId}", async () => {
            await client.getByCountry(11);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/leagues/countries/11",
                undefined,
                entity,
            );
        });
    });

    describe("search()", () => {
        it("calls GET /leagues/search/{name} with URL-encoded name", async () => {
            await client.search("Premier League");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/leagues/search/Premier%20League",
                undefined,
                entity,
            );
        });
    });
});

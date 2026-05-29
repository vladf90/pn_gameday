import {beforeEach, describe, expect, it, vi} from "vitest";
import {FixturesClient} from "../../../../src/sportmonks/clients/FixturesClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("FixturesClient", () => {
    let http: SportmonksHttpClient;
    let client: FixturesClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new FixturesClient(http);
    });

    const entity = {entity: "Fixture"};

    describe("getAll()", () => {
        it("calls GET /fixtures with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/fixtures", undefined, entity);
        });

        it("builds include query param when includes provided", async () => {
            await client.getAll({includes: ["scores", "state"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures",
                {include: "scores;state"},
                entity,
            );
        });
    });

    describe("getById()", () => {
        it("calls GET /fixtures/{id}", async () => {
            await client.getById(42);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/fixtures/42", undefined, entity);
        });

        it("passes includes when provided", async () => {
            await client.getById(42, {includes: ["participants"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/42",
                {include: "participants"},
                entity,
            );
        });
    });

    describe("getMulti()", () => {
        it("calls GET /fixtures/multi/{ids} with comma-joined IDs", async () => {
            await client.getMulti([1, 2, 3]);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/multi/1,2,3",
                undefined,
                entity,
            );
        });

        it("passes include query param when includes provided", async () => {
            await client.getMulti([10, 20], {includes: ["scores", "events"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/multi/10,20",
                {include: "scores;events"},
                entity,
            );
        });

        it("returns the value resolved by the http client", async () => {
            const fixtures = [{id: 1}, {id: 2}];
            vi.mocked(http.get).mockResolvedValueOnce(fixtures);
            await expect(client.getMulti([1, 2])).resolves.toEqual(fixtures);
        });
    });

    describe("getByDate()", () => {
        it("calls GET /fixtures/date/{date}", async () => {
            await client.getByDate("2024-06-01");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/date/2024-06-01",
                undefined,
                entity,
            );
        });
    });

    describe("getByDateRange()", () => {
        it("calls GET /fixtures/between/{start}/{end}", async () => {
            await client.getByDateRange("2024-06-01", "2024-06-30");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/between/2024-06-01/2024-06-30",
                undefined,
                entity,
            );
        });
    });

    describe("getByDateRangeForTeam()", () => {
        it("calls GET /fixtures/between/{start}/{end}/{teamId}", async () => {
            await client.getByDateRangeForTeam("2024-06-01", "2024-06-30", 99);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/between/2024-06-01/2024-06-30/99",
                undefined,
                entity,
            );
        });
    });

    describe("getHeadToHead()", () => {
        it("calls GET /fixtures/head-to-head/{teamA}/{teamB}", async () => {
            await client.getHeadToHead(11, 22);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/head-to-head/11/22",
                undefined,
                entity,
            );
        });
    });

    describe("search()", () => {
        it("calls GET /fixtures/search/{name} with URL-encoded name", async () => {
            await client.search("Manchester United");
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/search/Manchester%20United",
                undefined,
                entity,
            );
        });
    });

    describe("getUpcomingByMarket()", () => {
        it("calls GET /fixtures/upcoming/markets/{marketId}", async () => {
            await client.getUpcomingByMarket(5);
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/fixtures/upcoming/markets/5",
                undefined,
                entity,
            );
        });
    });

    describe("getLatest()", () => {
        it("calls GET /fixtures/latest", async () => {
            await client.getLatest();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/fixtures/latest", undefined, entity);
        });
    });
});

import {beforeEach, describe, expect, it, vi} from "vitest";
import {LivescoresClient} from "../../../../src/sportmonks/clients/LivescoresClient";
import type {SportmonksHttpClient} from "../../../../src/sportmonks/clients/SportmonksHttpClient";

function makeHttp(): SportmonksHttpClient {
    return {
        get: vi.fn().mockResolvedValue([]),
    } as unknown as SportmonksHttpClient;
}

describe("LivescoresClient", () => {
    let http: SportmonksHttpClient;
    let client: LivescoresClient;

    beforeEach(() => {
        vi.clearAllMocks();
        http = makeHttp();
        client = new LivescoresClient(http);
    });

    const entity = {entity: "Livescore"};

    describe("getAll()", () => {
        it("calls GET /livescores with no query when no includes given", async () => {
            await client.getAll();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/livescores", undefined, entity);
        });

        it("builds a semicolon-joined include query when includes provided", async () => {
            await client.getAll({includes: ["scores", "state"]});
            expect(vi.mocked(http.get)).toHaveBeenCalledWith(
                "/livescores",
                {include: "scores;state"},
                entity,
            );
        });
    });

    describe("getInplay()", () => {
        it("calls GET /livescores/inplay", async () => {
            await client.getInplay();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/livescores/inplay", undefined, entity);
        });
    });

    describe("getLatest()", () => {
        it("calls GET /livescores/latest", async () => {
            await client.getLatest();
            expect(vi.mocked(http.get)).toHaveBeenCalledWith("/livescores/latest", undefined, entity);
        });
    });
});

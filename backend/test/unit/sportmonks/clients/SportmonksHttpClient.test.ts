import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../../../src/sportmonks/metrics", () => ({
    // Used by SportmonksHttpClient directly:
    sportmonksApiCallsTotal: {labels: vi.fn().mockReturnValue({inc: vi.fn()})},
    sportmonksApiCallDurationSeconds: {labels: vi.fn().mockReturnValue({observe: vi.fn()})},
    sportmonksRateLimitThrottledTotal: {labels: vi.fn().mockReturnValue({inc: vi.fn()})},
    endpointLabel: vi.fn().mockImplementation((p: string) => p.split("?")[0]),
    // Used by RateLimitTracker (which SportmonksHttpClient depends on):
    sportmonksRateLimitRemaining: {labels: vi.fn().mockReturnValue({set: vi.fn()})},
    sportmonksRateLimitResetSeconds: {labels: vi.fn().mockReturnValue({set: vi.fn()})},
}));

vi.mock("../../../../src/Logger", () => ({
    Logger: vi.fn().mockImplementation(() => ({
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    })),
}));

import {
    SportmonksHttpClient,
    SportmonksHttpError,
} from "../../../../src/sportmonks/clients/SportmonksHttpClient";
import {RateLimitTracker} from "../../../../src/sportmonks/RateLimitTracker";
import type {SportmonksResponseEnvelope} from "../../../../src/sportmonks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope<T>(data: T, rateLimitOverride?: Partial<{remaining: number; requested_entity: string; resets_in_seconds: number}>): SportmonksResponseEnvelope<T> {
    return {
        data,
        rate_limit: {
            remaining: 100,
            requested_entity: "Fixture",
            resets_in_seconds: 3600,
            ...rateLimitOverride,
        },
    };
}

function makeResponse(status: number, body: unknown, ok?: boolean): Response {
    return {
        status,
        ok: ok ?? (status >= 200 && status < 300),
        json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

function makeClient(fetchImpl: typeof fetch, tracker?: RateLimitTracker): SportmonksHttpClient {
    return new SportmonksHttpClient(
        {apiToken: "test-token", baseUrl: "https://api.sportmonks.com/v3/football", fetchImpl},
        tracker ?? new RateLimitTracker(),
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SportmonksHttpClient", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let rateLimitTracker: RateLimitTracker;

    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock = vi.fn();
        rateLimitTracker = {
            record: vi.fn(),
            get: vi.fn(),
            getAll: vi.fn(),
        } as unknown as RateLimitTracker;
    });

    // -----------------------------------------------------------------------
    // Constructor guards
    // -----------------------------------------------------------------------

    describe("constructor", () => {
        it("throws when fetchImpl is explicitly set to a non-function value", () => {
            // In Node 20 globalThis.fetch exists, so we pass a non-function
            // explicitly rather than relying on the global being absent.
            expect(() => new SportmonksHttpClient(
                {apiToken: "tok", baseUrl: "https://api.sportmonks.com", fetchImpl: 42 as unknown as typeof fetch},
                rateLimitTracker,
            )).toThrow(/global fetch is not available/);
        });

        it("strips a trailing slash from baseUrl so the path is never double-slashed", async () => {
            const env = makeEnvelope({id: 1});
            fetchMock.mockResolvedValue(makeResponse(200, env));

            // baseUrl ends with a slash — the constructor should strip it
            const client = new SportmonksHttpClient(
                {apiToken: "test-token", baseUrl: "https://api.sportmonks.com/v3/football/", fetchImpl: fetchMock as unknown as typeof fetch},
                new RateLimitTracker(),
            );
            await client.get("/fixtures/1", undefined, {entity: "Fixture"});

            const url: string = fetchMock.mock.calls[0][0];
            // The path segment between baseUrl and /fixtures/1 must not be //
            expect(url).not.toContain("football//");
        });
    });

    // -----------------------------------------------------------------------
    // Successful GET
    // -----------------------------------------------------------------------

    describe("get() — success path", () => {
        it("returns the unwrapped envelope.data", async () => {
            const payload = [{id: 1}, {id: 2}];
            fetchMock.mockResolvedValue(makeResponse(200, makeEnvelope(payload)));

            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);
            const result = await client.get<typeof payload>("/fixtures", undefined, {entity: "Fixture"});

            expect(result).toEqual(payload);
        });

        it("appends query parameters to the URL", async () => {
            fetchMock.mockResolvedValue(makeResponse(200, makeEnvelope([])));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await client.get("/fixtures", {include: "scores;state"}, {entity: "Fixture"});

            const url: string = fetchMock.mock.calls[0][0];
            expect(url).toContain("include=scores%3Bstate");
        });

        it("sends the Authorization header with the api token", async () => {
            fetchMock.mockResolvedValue(makeResponse(200, makeEnvelope({})));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await client.get("/fixtures/1", undefined, {entity: "Fixture"});

            const requestInit: RequestInit = fetchMock.mock.calls[0][1];
            expect((requestInit.headers as Record<string, string>)["Authorization"]).toBe("test-token");
        });

        it("records the rate-limit block in RateLimitTracker", async () => {
            const env = makeEnvelope({id: 1}, {remaining: 42, requested_entity: "Fixture", resets_in_seconds: 1800});
            fetchMock.mockResolvedValue(makeResponse(200, env));

            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);
            await client.get("/fixtures/1", undefined, {entity: "Fixture"});

            expect(vi.mocked(rateLimitTracker.record)).toHaveBeenCalledWith("Fixture", 42, 1800);
        });

        it("silently skips rate-limit recording when the envelope has no rate_limit block", async () => {
            const envWithoutRateLimit: SportmonksResponseEnvelope<object> = {data: {id: 1}};
            fetchMock.mockResolvedValue(makeResponse(200, envWithoutRateLimit));

            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);
            await expect(client.get("/fixtures/1", undefined, {entity: "Fixture"})).resolves.toBeDefined();

            expect(vi.mocked(rateLimitTracker.record)).not.toHaveBeenCalled();
        });

        it("silently skips rate-limit recording when rate_limit has wrong types", async () => {
            const malformedEnv = {data: {id: 1}, rate_limit: {remaining: "oops", requested_entity: 123, resets_in_seconds: "bad"}};
            fetchMock.mockResolvedValue(makeResponse(200, malformedEnv));

            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);
            await expect(client.get("/fixtures/1", undefined, {entity: "Fixture"})).resolves.toBeDefined();

            expect(vi.mocked(rateLimitTracker.record)).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // HTTP 429 — throttled
    // -----------------------------------------------------------------------

    describe("get() — HTTP 429 throttled", () => {
        it("throws SportmonksHttpError with status 429", async () => {
            fetchMock.mockResolvedValue(makeResponse(429, null, false));
            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);

            await expect(
                client.get("/fixtures", undefined, {entity: "Fixture"}),
            ).rejects.toMatchObject({
                name: "SportmonksHttpError",
                status: 429,
            });
        });

        it("includes entity and endpoint on the thrown error", async () => {
            fetchMock.mockResolvedValue(makeResponse(429, null, false));
            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);

            const err = await client.get("/fixtures", undefined, {entity: "Fixture"}).catch((e) => e) as SportmonksHttpError;

            expect(err).toBeInstanceOf(SportmonksHttpError);
            expect(err.entity).toBe("Fixture");
            expect(err.endpoint).toBe("/fixtures");
        });
    });

    // -----------------------------------------------------------------------
    // Non-2xx (non-429) errors
    // -----------------------------------------------------------------------

    describe("get() — non-2xx response", () => {
        it("throws SportmonksHttpError for HTTP 500", async () => {
            fetchMock.mockResolvedValue(makeResponse(500, makeEnvelope(null), false));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await expect(
                client.get("/fixtures/1", undefined, {entity: "Fixture"}),
            ).rejects.toMatchObject({name: "SportmonksHttpError", status: 500});
        });

        it("throws SportmonksHttpError for HTTP 401", async () => {
            fetchMock.mockResolvedValue(makeResponse(401, makeEnvelope(null), false));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await expect(
                client.get("/fixtures/1", undefined, {entity: "Fixture"}),
            ).rejects.toMatchObject({name: "SportmonksHttpError", status: 401});
        });

        it("still records a valid rate_limit block even on a non-2xx response", async () => {
            const env = makeEnvelope(null, {remaining: 0, requested_entity: "Fixture", resets_in_seconds: 3600});
            fetchMock.mockResolvedValue(makeResponse(503, env, false));

            const client = makeClient(fetchMock as unknown as typeof fetch, rateLimitTracker);
            await client.get("/fixtures", undefined, {entity: "Fixture"}).catch(() => {});

            expect(vi.mocked(rateLimitTracker.record)).toHaveBeenCalledWith("Fixture", 0, 3600);
        });
    });

    // -----------------------------------------------------------------------
    // Malformed JSON
    // -----------------------------------------------------------------------

    describe("get() — malformed JSON", () => {
        it("throws SportmonksHttpError when the response body is not valid JSON", async () => {
            const badResponse = {
                status: 200,
                ok: true,
                json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
            } as unknown as Response;
            fetchMock.mockResolvedValue(badResponse);

            const client = makeClient(fetchMock as unknown as typeof fetch);
            await expect(
                client.get("/fixtures", undefined, {entity: "Fixture"}),
            ).rejects.toMatchObject({name: "SportmonksHttpError", message: /not valid JSON/});
        });
    });

    // -----------------------------------------------------------------------
    // URL construction
    // -----------------------------------------------------------------------

    describe("URL construction", () => {
        it("prepends a leading slash when path does not start with /", async () => {
            fetchMock.mockResolvedValue(makeResponse(200, makeEnvelope([])));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await client.get("fixtures", undefined, {entity: "Fixture"});

            const url: string = fetchMock.mock.calls[0][0];
            expect(url).toContain("/fixtures");
        });

        it("builds correct URL for multi-fixture path", async () => {
            fetchMock.mockResolvedValue(makeResponse(200, makeEnvelope([])));
            const client = makeClient(fetchMock as unknown as typeof fetch);

            await client.get("/fixtures/multi/1,2,3", {include: "scores"}, {entity: "Fixture"});

            const url: string = fetchMock.mock.calls[0][0];
            expect(url).toContain("/fixtures/multi/1,2,3");
            expect(url).toContain("include=scores");
        });
    });

    // -----------------------------------------------------------------------
    // SportmonksHttpError shape
    // -----------------------------------------------------------------------

    describe("SportmonksHttpError", () => {
        it("is an instance of Error", () => {
            const err = new SportmonksHttpError("msg", 500, "Fixture", "/fixtures");
            expect(err).toBeInstanceOf(Error);
        });

        it("exposes status, entity, endpoint as public fields", () => {
            const err = new SportmonksHttpError("msg", 404, "Team", "/teams/1");
            expect(err.status).toBe(404);
            expect(err.entity).toBe("Team");
            expect(err.endpoint).toBe("/teams/1");
            expect(err.name).toBe("SportmonksHttpError");
        });
    });
});

/**
 * Unit tests for RequestClient — the base HTTP client.
 *
 * axios.request is mocked at the module boundary so no real HTTP occurs.
 * Tests verify URL construction, method, auth header injection, and response
 * unwrapping (`response.data.data`).
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

const {axiosRequestMock} = vi.hoisted(() => ({axiosRequestMock: vi.fn()}));

vi.mock("axios", () => ({
    default: {request: axiosRequestMock, post: vi.fn()},
}));

import {RequestClient} from "../../../src/clients/RequestClient";

function makeResponse(data: unknown) {
    return {data: {data}};
}

describe("RequestClient", () => {
    let client: RequestClient;

    beforeEach(() => {
        axiosRequestMock.mockReset();
        localStorage.clear();
        client = new RequestClient();
    });

    // -----------------------------------------------------------------------
    // get
    // -----------------------------------------------------------------------

    describe("get", () => {
        it("calls axios.request with method=get, baseURL=/api, and the path", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(["a", "b"]));
            await client.get("/fixtures");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "get", baseURL: "/api", url: "/fixtures"}),
            );
        });

        it("forwards query params", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse([]));
            await client.get("/fixtures", {date: "2025-01-01"});
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({params: {date: "2025-01-01"}}),
            );
        });

        it("returns response.data.data", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 42}));
            const result = await client.get("/foo");
            expect(result).toEqual({id: 42});
        });

        it("does NOT send Authorization header when no token in localStorage", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(null));
            await client.get("/foo");
            const config = axiosRequestMock.mock.calls[0][0];
            expect(config.headers).toBeUndefined();
        });

        it("sends Bearer token when token is present in localStorage", async () => {
            localStorage.setItem("token", "my-jwt");
            axiosRequestMock.mockResolvedValueOnce(makeResponse(null));
            await client.get("/foo");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: {Authorization: "Bearer my-jwt"},
                }),
            );
        });

        it("propagates errors thrown by axios", async () => {
            axiosRequestMock.mockRejectedValueOnce(new Error("network down"));
            await expect(client.get("/foo")).rejects.toThrow("network down");
        });
    });

    // -----------------------------------------------------------------------
    // post
    // -----------------------------------------------------------------------

    describe("post", () => {
        it("calls axios.request with method=post and the request body in data", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 1}));
            await client.post("/sessions", {name: "Test"});
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "post",
                    url: "/sessions",
                    data: {name: "Test"},
                }),
            );
        });

        it("returns response.data.data", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 99}));
            const result = await client.post("/sessions", {name: "x"});
            expect(result).toEqual({id: 99});
        });
    });

    // -----------------------------------------------------------------------
    // patch
    // -----------------------------------------------------------------------

    describe("patch", () => {
        it("calls axios.request with method=patch", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 1}));
            await client.patch("/sessions/1", {name: "Renamed"});
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "patch", url: "/sessions/1"}),
            );
        });
    });

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    describe("delete", () => {
        it("calls axios.request with method=delete", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 1}));
            await client.delete("/sessions/1");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "delete", url: "/sessions/1"}),
            );
        });
    });
});

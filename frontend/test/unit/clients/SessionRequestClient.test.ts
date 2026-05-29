/**
 * Unit tests for SessionRequestClient.
 *
 * axios.request is mocked at the module boundary so no real HTTP occurs.
 * Tests verify URLs, HTTP methods, request bodies, and response passthrough.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

const {axiosRequestMock} = vi.hoisted(() => ({axiosRequestMock: vi.fn()}));

vi.mock("axios", () => ({
    default: {request: axiosRequestMock, post: vi.fn()},
}));

import {SessionRequestClient} from "../../../src/clients/SessionRequestClient";
import type {SessionSummary, SessionDetail} from "../../../src/clients/SessionRequestClient";

function makeResponse(data: unknown) {
    return {data: {data}};
}

const fakeSummary: SessionSummary = {
    id: 7,
    name: "Saturday watchalong",
    endedAt: null,
    createdAt: "2025-06-01T10:00:00Z",
    updatedAt: "2025-06-01T10:00:00Z",
    overlayUrl: "/overlay/abc",
};

const fakeDetail: SessionDetail = {
    ...fakeSummary,
    fixtureIds: [101, 102],
};

describe("SessionRequestClient", () => {
    let client: SessionRequestClient;

    beforeEach(() => {
        axiosRequestMock.mockReset();
        localStorage.clear();
        client = new SessionRequestClient();
    });

    describe("list", () => {
        it("sends GET /sessions with default status=active", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse([fakeSummary]));
            await client.list();
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "get",
                    url: "/sessions",
                    params: {status: "active"},
                }),
            );
        });

        it("sends the provided status filter", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse([]));
            await client.list("all");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({params: {status: "all"}}),
            );
        });

        it("returns session summary array", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse([fakeSummary]));
            const result = await client.list();
            expect(result).toEqual([fakeSummary]);
        });
    });

    describe("getOne", () => {
        it("sends GET /sessions/:id", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeDetail));
            await client.getOne(7);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "get", url: "/sessions/7"}),
            );
        });

        it("returns the session detail", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeDetail));
            const result = await client.getOne(7);
            expect(result).toEqual(fakeDetail);
        });
    });

    describe("create", () => {
        it("posts to /sessions with the name in the body", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeSummary));
            await client.create("My session");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "post",
                    url: "/sessions",
                    data: {name: "My session"},
                }),
            );
        });
    });

    describe("rename", () => {
        it("patches /sessions/:id with the new name", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeSummary));
            await client.rename(7, "Renamed session");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "patch",
                    url: "/sessions/7",
                    data: {name: "Renamed session"},
                }),
            );
        });
    });

    describe("remove", () => {
        it("sends DELETE /sessions/:id", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse({id: 7}));
            await client.remove(7);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "delete", url: "/sessions/7"}),
            );
        });
    });

    describe("end", () => {
        it("posts to /sessions/:id/end", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeSummary));
            await client.end(7);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "post", url: "/sessions/7/end"}),
            );
        });
    });

    describe("rotateOverlayToken", () => {
        it("posts to /sessions/:id/overlay/token/rotate", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fakeSummary));
            await client.rotateOverlayToken(7);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "post",
                    url: "/sessions/7/overlay/token/rotate",
                }),
            );
        });
    });

    describe("attachFixture", () => {
        it("posts to /sessions/:id/fixtures with sportmonksFixtureId", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({sessionId: 7, sportmonksFixtureId: 999}),
            );
            await client.attachFixture(7, 999);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "post",
                    url: "/sessions/7/fixtures",
                    data: {sportmonksFixtureId: 999},
                }),
            );
        });
    });

    describe("detachFixture", () => {
        it("sends DELETE /sessions/:sessionId/fixtures/:fixtureId", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({sessionId: 7, sportmonksFixtureId: 999}),
            );
            await client.detachFixture(7, 999);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "delete",
                    url: "/sessions/7/fixtures/999",
                }),
            );
        });
    });

    describe("getLive", () => {
        it("sends GET /sessions/:id/live", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({sessionId: 7, fixtures: [], missingFixtureIds: []}),
            );
            await client.getLive(7);
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({method: "get", url: "/sessions/7/live"}),
            );
        });
    });
});

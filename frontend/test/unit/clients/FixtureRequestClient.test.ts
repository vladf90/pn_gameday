/**
 * Unit tests for FixtureRequestClient.
 *
 * axios.request is mocked at the module boundary so no real HTTP occurs.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

const {axiosRequestMock} = vi.hoisted(() => ({axiosRequestMock: vi.fn()}));

vi.mock("axios", () => ({
    default: {request: axiosRequestMock, post: vi.fn()},
}));

import {FixtureRequestClient} from "../../../src/clients/FixtureRequestClient";

function makeResponse(data: unknown) {
    return {data: {data}};
}

describe("FixtureRequestClient", () => {
    let client: FixtureRequestClient;

    beforeEach(() => {
        axiosRequestMock.mockReset();
        localStorage.clear();
        client = new FixtureRequestClient();
    });

    describe("getByDate", () => {
        it("sends GET /fixtures with the date param", async () => {
            axiosRequestMock.mockResolvedValueOnce(makeResponse([]));
            await client.getByDate("2025-06-01");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "get",
                    url: "/fixtures",
                    params: {date: "2025-06-01"},
                }),
            );
        });

        it("returns the fixture array from the response", async () => {
            const fixtures = [{id: 1, name: "Arsenal vs Chelsea"}];
            axiosRequestMock.mockResolvedValueOnce(makeResponse(fixtures));
            const result = await client.getByDate("2025-06-01");
            expect(result).toEqual(fixtures);
        });

        it("sends the Bearer token if one is in localStorage", async () => {
            localStorage.setItem("token", "test-token");
            axiosRequestMock.mockResolvedValueOnce(makeResponse([]));
            await client.getByDate("2025-06-01");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: {Authorization: "Bearer test-token"},
                }),
            );
        });

        it("propagates errors", async () => {
            axiosRequestMock.mockRejectedValueOnce(new Error("500 Internal Server Error"));
            await expect(client.getByDate("2025-06-01")).rejects.toThrow("500 Internal Server Error");
        });
    });
});

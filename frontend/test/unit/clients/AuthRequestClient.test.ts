/**
 * Unit tests for AuthRequestClient.
 *
 * We mock the underlying axios transport (via the RequestClient base) so no
 * real HTTP happens. Tests verify that the client calls the correct endpoint
 * with the expected payload and returns the unwrapped response.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

const {axiosRequestMock} = vi.hoisted(() => ({axiosRequestMock: vi.fn()}));

vi.mock("axios", () => ({
    default: {request: axiosRequestMock, post: vi.fn()},
}));

import {AuthRequestClient} from "../../../src/clients/AuthRequestClient";

function makeResponse(data: unknown) {
    return {data: {data}};
}

describe("AuthRequestClient", () => {
    let client: AuthRequestClient;

    beforeEach(() => {
        axiosRequestMock.mockReset();
        localStorage.clear();
        client = new AuthRequestClient();
    });

    describe("login", () => {
        it("posts to /auth/login with username and password", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({token: "t", permissions: [], firstName: "Alice", lastName: "A"}),
            );
            await client.login({username: "alice@example.com", password: "secret"});
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "post",
                    url: "/auth/login",
                    data: {username: "alice@example.com", password: "secret"},
                }),
            );
        });

        it("returns the login response", async () => {
            const loginResponse = {
                token: "jwt-abc",
                permissions: ["fixture:read"],
                firstName: "Alice",
                lastName: "Anderson",
            };
            axiosRequestMock.mockResolvedValueOnce(makeResponse(loginResponse));
            const result = await client.login({username: "alice@example.com", password: "secret"});
            expect(result).toEqual(loginResponse);
        });

        it("propagates errors thrown by the transport layer", async () => {
            axiosRequestMock.mockRejectedValueOnce(new Error("401 Unauthorized"));
            await expect(
                client.login({username: "bad@example.com", password: "wrong"}),
            ).rejects.toThrow("401 Unauthorized");
        });
    });
});

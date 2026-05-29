/**
 * Unit tests for createAuthProvider (providers/AuthProvider.ts).
 *
 * The `AuthRequestClient` is replaced with a vi.fn() mock so no HTTP is made.
 * localStorage is cleared before each test.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createAuthProvider} from "../../../src/providers/AuthProvider";

function makeClient(overrides: {login?: ReturnType<typeof vi.fn>} = {}) {
    return {
        login: overrides.login ?? vi.fn(),
    } as unknown as import("../../../src/clients/AuthRequestClient").AuthRequestClient;
}

describe("createAuthProvider", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    // -----------------------------------------------------------------------
    // login
    // -----------------------------------------------------------------------

    describe("login", () => {
        it("stores token, permissions, firstName, lastName in localStorage on success", async () => {
            const loginMock = vi.fn().mockResolvedValue({
                token: "jwt-abc",
                permissions: ["fixture:read"],
                firstName: "Alice",
                lastName: "Anderson",
            });
            const provider = createAuthProvider(makeClient({login: loginMock}));
            const result = await provider.login({email: "alice@example.com", password: "secret"});
            expect(result.success).toBe(true);
            expect(localStorage.getItem("token")).toBe("jwt-abc");
            expect(localStorage.getItem("permissions")).toBe(JSON.stringify(["fixture:read"]));
            expect(localStorage.getItem("firstName")).toBe("Alice");
            expect(localStorage.getItem("lastName")).toBe("Anderson");
        });

        it("redirects to / on success", async () => {
            const loginMock = vi.fn().mockResolvedValue({
                token: "t",
                permissions: [],
                firstName: "A",
                lastName: "B",
            });
            const provider = createAuthProvider(makeClient({login: loginMock}));
            const result = await provider.login({email: "a@b.com", password: "pw"});
            expect(result).toMatchObject({success: true, redirectTo: "/"});
        });

        it("returns failure when the response has no token", async () => {
            const loginMock = vi.fn().mockResolvedValue({
                token: "",
                permissions: [],
                firstName: "",
                lastName: "",
            });
            const provider = createAuthProvider(makeClient({login: loginMock}));
            const result = await provider.login({email: "a@b.com", password: "pw"});
            expect(result.success).toBe(false);
            expect(localStorage.getItem("token")).toBeNull();
        });

        it("returns failure when the client throws", async () => {
            const loginMock = vi.fn().mockRejectedValue(new Error("network down"));
            const provider = createAuthProvider(makeClient({login: loginMock}));
            const result = await provider.login({email: "a@b.com", password: "pw"});
            expect(result.success).toBe(false);
            expect((result as {error?: {message: string}}).error?.message).toBe("Login failed");
        });
    });

    // -----------------------------------------------------------------------
    // logout
    // -----------------------------------------------------------------------

    describe("logout", () => {
        it("clears all auth keys from localStorage", async () => {
            localStorage.setItem("token", "t");
            localStorage.setItem("permissions", "[]");
            localStorage.setItem("firstName", "Alice");
            localStorage.setItem("lastName", "A");
            const provider = createAuthProvider(makeClient());
            await provider.logout({});
            expect(localStorage.getItem("token")).toBeNull();
            expect(localStorage.getItem("permissions")).toBeNull();
            expect(localStorage.getItem("firstName")).toBeNull();
            expect(localStorage.getItem("lastName")).toBeNull();
        });

        it("redirects to /login on logout", async () => {
            const provider = createAuthProvider(makeClient());
            const result = await provider.logout({});
            expect(result).toMatchObject({success: true, redirectTo: "/login"});
        });
    });

    // -----------------------------------------------------------------------
    // check
    // -----------------------------------------------------------------------

    describe("check", () => {
        it("returns authenticated: true when a token exists", async () => {
            localStorage.setItem("token", "jwt");
            const provider = createAuthProvider(makeClient());
            const result = await provider.check({});
            expect(result.authenticated).toBe(true);
        });

        it("returns authenticated: false and redirectTo=/login when no token", async () => {
            const provider = createAuthProvider(makeClient());
            const result = await provider.check({});
            expect(result.authenticated).toBe(false);
            expect((result as {redirectTo?: string}).redirectTo).toBe("/login");
        });
    });

    // -----------------------------------------------------------------------
    // getPermissions
    // -----------------------------------------------------------------------

    describe("getPermissions", () => {
        it("returns parsed permissions array from localStorage", async () => {
            localStorage.setItem("permissions", JSON.stringify(["user:read", "fixture:read"]));
            const provider = createAuthProvider(makeClient());
            const perms = await provider.getPermissions?.({});
            expect(perms).toEqual(["user:read", "fixture:read"]);
        });

        it("returns empty array when permissions key is absent", async () => {
            const provider = createAuthProvider(makeClient());
            const perms = await provider.getPermissions?.({});
            expect(perms).toEqual([]);
        });

        it("returns empty array when permissions value is invalid JSON", async () => {
            localStorage.setItem("permissions", "{bad json");
            const provider = createAuthProvider(makeClient());
            const perms = await provider.getPermissions?.({});
            expect(perms).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getIdentity
    // -----------------------------------------------------------------------

    describe("getIdentity", () => {
        it("returns identity with firstName and lastName when token exists", async () => {
            localStorage.setItem("token", "t");
            localStorage.setItem("firstName", "Alice");
            localStorage.setItem("lastName", "Anderson");
            const provider = createAuthProvider(makeClient());
            const identity = await provider.getIdentity?.({});
            expect(identity).toMatchObject({
                name: "Alice",
                fullName: "Alice Anderson",
            });
        });

        it("returns null when no token", async () => {
            const provider = createAuthProvider(makeClient());
            const identity = await provider.getIdentity?.({});
            expect(identity).toBeNull();
        });

        it("falls back to 'User' when firstName is absent", async () => {
            localStorage.setItem("token", "t");
            const provider = createAuthProvider(makeClient());
            const identity = await provider.getIdentity?.({});
            expect((identity as {name: string} | null)?.name).toBe("User");
        });
    });

    // -----------------------------------------------------------------------
    // onError
    // -----------------------------------------------------------------------

    describe("onError", () => {
        it("returns logout: true and clears token on 401", async () => {
            localStorage.setItem("token", "t");
            const provider = createAuthProvider(makeClient());
            const result = await provider.onError({status: 401});
            expect(result.logout).toBe(true);
            expect(localStorage.getItem("token")).toBeNull();
        });

        it("returns logout: true and clears token on 403", async () => {
            localStorage.setItem("token", "t");
            const provider = createAuthProvider(makeClient());
            const result = await provider.onError({status: 403});
            expect(result.logout).toBe(true);
        });

        it("returns logout: false for non-auth errors", async () => {
            const provider = createAuthProvider(makeClient());
            const result = await provider.onError({status: 500});
            expect(result.logout).toBe(false);
        });
    });
});

/**
 * Unit tests for createAccessControlProvider (providers/AccessControlProvider.ts).
 *
 * The provider reads from localStorage — no mocking of the module; we seed
 * localStorage directly before each test.
 */
import {beforeEach, describe, expect, it} from "vitest";
import {createAccessControlProvider} from "../../../src/providers/AccessControlProvider";

describe("createAccessControlProvider", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe("can", () => {
        it("denies access when there is no token in localStorage", async () => {
            const provider = createAccessControlProvider();
            const result = await provider.can({resource: "sessions", action: "list", params: {}});
            expect(result.can).toBe(false);
        });

        it("allows access when token exists but permissions list is empty (skeleton mode)", async () => {
            localStorage.setItem("token", "jwt");
            const provider = createAccessControlProvider();
            const result = await provider.can({resource: "sessions", action: "list", params: {}});
            expect(result.can).toBe(true);
        });

        it("allows access for an unknown resource (not in the resource map) even with permissions", async () => {
            localStorage.setItem("token", "jwt");
            localStorage.setItem("permissions", JSON.stringify(["fixture:read"]));
            const provider = createAccessControlProvider();
            // "sessions" is not in the resourcePermissions map → allow by default
            const result = await provider.can({resource: "sessions", action: "list", params: {}});
            expect(result.can).toBe(true);
        });

        it("allows access when resource is undefined", async () => {
            localStorage.setItem("token", "jwt");
            localStorage.setItem("permissions", JSON.stringify(["fixture:read"]));
            const provider = createAccessControlProvider();
            const result = await provider.can({resource: undefined, action: "list", params: {}});
            expect(result.can).toBe(true);
        });

        it("allows access when permissions JSON is malformed (treats as empty → allow)", async () => {
            localStorage.setItem("token", "jwt");
            localStorage.setItem("permissions", "{bad-json");
            const provider = createAccessControlProvider();
            const result = await provider.can({resource: "sessions", action: "list", params: {}});
            // Empty permissions → allowed (skeleton mode)
            expect(result.can).toBe(true);
        });
    });
});

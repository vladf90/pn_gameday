import {describe, expect, it} from "vitest";

import {
    ROLES,
    getPermissionsForRole,
    getPermissionStrings,
    hasPermission,
} from "../../../src/config/permissions";

describe("ROLES", () => {
    it("defines 'admin' and 'user' roles", () => {
        expect(ROLES).toHaveProperty("admin");
        expect(ROLES).toHaveProperty("user");
    });

    it("admin role has a wildcard '*:*' permission", () => {
        const adminPerms = ROLES.admin.permissions;
        expect(adminPerms).toContainEqual({resource: "*", action: "*"});
    });

    it("user role has session and fixture permissions", () => {
        const userPerms = ROLES.user.permissions;
        const actions = userPerms.map(p => `${p.resource}:${p.action}`);
        expect(actions).toContain("session:read");
        expect(actions).toContain("session:create");
        expect(actions).toContain("session:update");
        expect(actions).toContain("session:delete");
        expect(actions).toContain("fixture:read");
    });
});

describe("getPermissionsForRole", () => {
    it("returns the permission objects for a known role", () => {
        const perms = getPermissionsForRole("user");
        expect(Array.isArray(perms)).toBe(true);
        expect(perms.length).toBeGreaterThan(0);
    });

    it("returns an empty array for an unknown role", () => {
        expect(getPermissionsForRole("nonexistent")).toEqual([]);
    });

    it("returns [] for an empty string role", () => {
        expect(getPermissionsForRole("")).toEqual([]);
    });
});

describe("getPermissionStrings", () => {
    it("formats permissions as 'resource:action' strings", () => {
        const strings = getPermissionStrings("user");
        expect(strings).toContain("session:read");
        expect(strings).toContain("fixture:read");
    });

    it("returns empty array for unknown role", () => {
        expect(getPermissionStrings("ghost")).toEqual([]);
    });

    it("admin role produces '*:*'", () => {
        expect(getPermissionStrings("admin")).toContain("*:*");
    });
});

describe("hasPermission", () => {
    describe("wildcard grant", () => {
        it("grants access when '*:*' is in the permissions list", () => {
            expect(hasPermission(["*:*"], "session", "delete")).toBe(true);
        });

        it("grants access for resource wildcard 'session:*'", () => {
            expect(hasPermission(["session:*"], "session", "create")).toBe(true);
            expect(hasPermission(["session:*"], "session", "read")).toBe(true);
            expect(hasPermission(["session:*"], "session", "update")).toBe(true);
            expect(hasPermission(["session:*"], "session", "delete")).toBe(true);
        });

        it("resource wildcard does NOT grant access to a different resource", () => {
            expect(hasPermission(["session:*"], "fixture", "read")).toBe(false);
        });
    });

    describe("exact match", () => {
        it("returns true for an exact resource:action match", () => {
            expect(hasPermission(["session:read", "fixture:read"], "session", "read")).toBe(true);
        });

        it("returns false when the action does not match", () => {
            expect(hasPermission(["session:read"], "session", "delete")).toBe(false);
        });

        it("returns false when the resource does not match", () => {
            expect(hasPermission(["session:read"], "fixture", "read")).toBe(false);
        });
    });

    describe("edge cases", () => {
        it("returns false for an empty permissions list", () => {
            expect(hasPermission([], "session", "read")).toBe(false);
        });

        it("handles multiple permissions correctly", () => {
            const perms = ["session:read", "session:create", "fixture:read"];
            expect(hasPermission(perms, "session", "create")).toBe(true);
            expect(hasPermission(perms, "session", "delete")).toBe(false);
        });
    });
});

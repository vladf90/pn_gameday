/**
 * Exemplar pure-logic test (issue #90, ADR 0009).
 *
 * `canAccessResource` is a side-effect-free helper — no React, no jsdom, no
 * mocking. Tests like this should be the fastest in the suite and the most
 * numerous; reach for this pattern any time you're adding a util.
 */
import {describe, expect, it} from "vitest";

import {canAccessResource, hasPermission} from "../../../src/common/permissions";

describe("canAccessResource", () => {
    // NOTE: `canAccessResource` only grants on wildcards — passing a specific
    // action permission like `user:read` does NOT grant "any-action" access
    // because the helper calls `hasPermission(..., '*')` and the implementation
    // skips the exact-match branch when the action is '*'. That's a latent
    // gap in the semantics; locking the current behavior in here so future
    // refactors are intentional rather than accidental.

    it("grants access via a resource wildcard", () => {
        expect(canAccessResource(["user:*"], "user")).toBe(true);
    });

    it("grants access via the full wildcard (admin)", () => {
        expect(canAccessResource(["*:*"], "anything")).toBe(true);
    });

    it("does NOT grant access on a specific action permission (see note above)", () => {
        expect(canAccessResource(["user:read"], "user")).toBe(false);
    });

    it("denies access when the permission list does not match", () => {
        expect(canAccessResource(["session:*"], "user")).toBe(false);
    });

    it("denies access on null / undefined / empty permission lists", () => {
        expect(canAccessResource(null, "user")).toBe(false);
        expect(canAccessResource(undefined, "user")).toBe(false);
        expect(canAccessResource([], "user")).toBe(false);
    });
});

describe("hasPermission", () => {
    it("grants on exact resource:action match", () => {
        expect(hasPermission(["user:create"], "user", "create")).toBe(true);
    });

    it("does NOT grant when the action differs", () => {
        // Subtle: `canAccessResource` uses action='*' which matches any
        // resource:* permission, but a specific action must match exactly.
        expect(hasPermission(["user:read"], "user", "create")).toBe(false);
    });

    it("resource wildcard matches any specific action on that resource", () => {
        expect(hasPermission(["user:*"], "user", "delete")).toBe(true);
    });

    it("full wildcard short-circuits regardless of resource/action", () => {
        expect(hasPermission(["*:*"], "fixture", "delete")).toBe(true);
    });
});

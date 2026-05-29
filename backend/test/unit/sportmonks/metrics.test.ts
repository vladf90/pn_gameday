import {describe, expect, it} from "vitest";
import {endpointLabel, entityLabelFromPath} from "../../../src/sportmonks/metrics";

/**
 * Tests for the pure helper functions in metrics.ts.
 *
 * The Prometheus counter/gauge/histogram instances are singletons bound to a
 * module-level Registry — they are NOT tested here because exercising them
 * directly would mutate shared global state and create ordering-dependent
 * test failures. The gauge/counter increment behaviour is exercised
 * indirectly by the RateLimitTracker and LiveSnapshotStore unit tests which
 * mock the metrics module.
 */
describe("endpointLabel()", () => {
    it("strips a numeric ID segment", () => {
        expect(endpointLabel("/fixtures/123")).toBe("/fixtures");
    });

    it("strips a comma-joined multi-ID segment", () => {
        expect(endpointLabel("/fixtures/multi/1,2,3")).toBe("/fixtures/multi");
    });

    it("strips a query string", () => {
        expect(endpointLabel("/fixtures?include=scores;state")).toBe("/fixtures");
    });

    it("strips both query string and numeric ID", () => {
        expect(endpointLabel("/fixtures/multi/1,2,3?include=scores")).toBe("/fixtures/multi");
    });

    it("preserves non-numeric path segments", () => {
        expect(endpointLabel("/fixtures/head-to-head/1/2")).toBe("/fixtures/head-to-head");
    });

    it("handles a root path correctly", () => {
        expect(endpointLabel("/")).toBe("/");
    });

    it("handles an empty string gracefully", () => {
        expect(endpointLabel("")).toBe("/");
    });

    it("handles a path without a leading slash", () => {
        expect(endpointLabel("fixtures/123")).toBe("/fixtures");
    });

    it("collapses /seasons/456 → /seasons", () => {
        expect(endpointLabel("/seasons/456")).toBe("/seasons");
    });
});

describe("entityLabelFromPath()", () => {
    it("returns 'Fixture' for paths containing /fixtures", () => {
        expect(entityLabelFromPath("/fixtures/multi/1,2,3")).toBe("Fixture");
    });

    it("returns 'Team' for /teams paths", () => {
        expect(entityLabelFromPath("/teams/123")).toBe("Team");
    });

    it("returns 'Player' for /players paths", () => {
        expect(entityLabelFromPath("/players/1")).toBe("Player");
    });

    it("returns 'League' for /leagues paths", () => {
        expect(entityLabelFromPath("/leagues")).toBe("League");
    });

    it("returns 'Season' for /seasons paths", () => {
        expect(entityLabelFromPath("/seasons/2024")).toBe("Season");
    });

    it("returns 'unknown' for an unrecognised path", () => {
        expect(entityLabelFromPath("/standings/1")).toBe("unknown");
    });

    it("is case-insensitive (path lowercased before matching)", () => {
        // endpointLabel lowercases before matching, so /Fixtures → /fixtures
        expect(entityLabelFromPath("/Fixtures/1")).toBe("Fixture");
    });
});

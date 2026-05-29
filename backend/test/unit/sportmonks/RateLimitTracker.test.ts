import {beforeEach, describe, expect, it, vi} from "vitest";

// Mock the metrics module before importing the class under test so the
// Prometheus constructors never run (they'd clash across test files sharing
// the same registry singleton).
vi.mock("../../../src/sportmonks/metrics", () => ({
    sportmonksRateLimitRemaining: {labels: vi.fn().mockReturnValue({set: vi.fn()})},
    sportmonksRateLimitResetSeconds: {labels: vi.fn().mockReturnValue({set: vi.fn()})},
}));

import {RateLimitTracker} from "../../../src/sportmonks/RateLimitTracker";
import {
    sportmonksRateLimitRemaining,
    sportmonksRateLimitResetSeconds,
} from "../../../src/sportmonks/metrics";

describe("RateLimitTracker", () => {
    let tracker: RateLimitTracker;

    beforeEach(() => {
        vi.clearAllMocks();
        tracker = new RateLimitTracker();
    });

    describe("record()", () => {
        it("stores the state for a new entity", () => {
            tracker.record("Fixture", 100, 3600);
            const state = tracker.get("Fixture");
            expect(state).toBeDefined();
            expect(state!.remaining).toBe(100);
            expect(state!.resetsInSeconds).toBe(3600);
            expect(state!.lastUpdatedAt).toBeInstanceOf(Date);
        });

        it("overwrites the state for an existing entity", () => {
            tracker.record("Fixture", 100, 3600);
            tracker.record("Fixture", 42, 1800);
            const state = tracker.get("Fixture");
            expect(state!.remaining).toBe(42);
            expect(state!.resetsInSeconds).toBe(1800);
        });

        it("tracks independent state for different entities", () => {
            tracker.record("Fixture", 10, 100);
            tracker.record("Team", 50, 200);
            expect(tracker.get("Fixture")!.remaining).toBe(10);
            expect(tracker.get("Team")!.remaining).toBe(50);
        });

        it("calls sportmonksRateLimitRemaining.labels(entity).set(remaining)", () => {
            const setRemaining = vi.fn();
            vi.mocked(sportmonksRateLimitRemaining.labels).mockReturnValueOnce({set: setRemaining} as never);

            tracker.record("League", 75, 900);

            expect(sportmonksRateLimitRemaining.labels).toHaveBeenCalledWith("League");
            expect(setRemaining).toHaveBeenCalledWith(75);
        });

        it("calls sportmonksRateLimitResetSeconds.labels(entity).set(resetsInSeconds)", () => {
            const setReset = vi.fn();
            vi.mocked(sportmonksRateLimitResetSeconds.labels).mockReturnValueOnce({set: setReset} as never);

            tracker.record("Season", 30, 450);

            expect(sportmonksRateLimitResetSeconds.labels).toHaveBeenCalledWith("Season");
            expect(setReset).toHaveBeenCalledWith(450);
        });
    });

    describe("get()", () => {
        it("returns undefined for an unknown entity", () => {
            expect(tracker.get("Unknown")).toBeUndefined();
        });

        it("returns the stored state after a record() call", () => {
            tracker.record("Player", 5, 60);
            expect(tracker.get("Player")).toMatchObject({remaining: 5, resetsInSeconds: 60});
        });
    });

    describe("getAll()", () => {
        it("returns an empty object when nothing has been recorded", () => {
            expect(tracker.getAll()).toEqual({});
        });

        it("returns all recorded entities", () => {
            tracker.record("Fixture", 100, 3600);
            tracker.record("Team", 50, 1800);

            const all = tracker.getAll();
            expect(Object.keys(all)).toHaveLength(2);
            expect(all["Fixture"]).toMatchObject({remaining: 100, resetsInSeconds: 3600});
            expect(all["Team"]).toMatchObject({remaining: 50, resetsInSeconds: 1800});
        });

        it("reflects the latest value after multiple records for the same entity", () => {
            tracker.record("Fixture", 100, 3600);
            tracker.record("Fixture", 1, 10);

            const all = tracker.getAll();
            expect(Object.keys(all)).toHaveLength(1);
            expect(all["Fixture"]!.remaining).toBe(1);
        });
    });
});

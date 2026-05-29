/**
 * Pure-logic unit tests for common/matchTimer.ts.
 *
 * All functions are deterministic from their inputs — no Date.now() reads,
 * no side-effects. Tests use a truth-table style for the key branches.
 */
import {describe, expect, it} from "vitest";

import {
    computeTimerMode,
    formatKickoffTime,
    formatRunningClock,
    reconcileTimerMode,
    TIMER_DRIFT_SNAP_MINUTES,
    type TimerMode,
} from "../../../src/common/matchTimer";
import type {FixtureModel} from "../../../src/common/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixture(overrides: Partial<FixtureModel> = {}): FixtureModel {
    return {id: 1, ...overrides};
}

// ---------------------------------------------------------------------------
// computeTimerMode
// ---------------------------------------------------------------------------

describe("computeTimerMode", () => {
    it("returns 'running' when a period is ticking with valid minutes", () => {
        const f = fixture({
            periods: [{id: 1, minutes: 37, seconds: 42, ticking: true}],
        });
        const mode = computeTimerMode(f, 1_000_000);
        expect(mode.kind).toBe("running");
        if (mode.kind === "running") {
            expect(mode.referenceMinute).toBe(37);
            expect(mode.referenceSeconds).toBe(42);
            expect(mode.referenceWallTime).toBe(1_000_000);
        }
    });

    it("clamps negative minutes to 0", () => {
        const f = fixture({
            periods: [{ticking: true, minutes: -5, seconds: 0}],
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("running");
        if (mode.kind === "running") {
            expect(mode.referenceMinute).toBe(0);
        }
    });

    it("clamps seconds to [0, 59]", () => {
        const f = fixture({
            periods: [{ticking: true, minutes: 10, seconds: 75}],
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("running");
        if (mode.kind === "running") {
            expect(mode.referenceSeconds).toBe(59);
        }
    });

    it("defaults seconds to 0 when missing from the period", () => {
        const f = fixture({
            periods: [{ticking: true, minutes: 10}],
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("running");
        if (mode.kind === "running") {
            expect(mode.referenceSeconds).toBe(0);
        }
    });

    it("returns 'kickoff' for NS state with a starting_at timestamp", () => {
        const f = fixture({
            state: {short_name: "NS"},
            starting_at: "2025-06-01T18:00:00Z",
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("kickoff");
        if (mode.kind === "kickoff") {
            expect(mode.startsAt).toBe("2025-06-01T18:00:00Z");
        }
    });

    it("returns 'kickoff' for TBA state with a starting_at timestamp", () => {
        const f = fixture({
            state: {short_name: "TBA"},
            starting_at: "2025-06-01T19:00:00Z",
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("kickoff");
    });

    it("returns 'state' for NS when starting_at is absent", () => {
        const f = fixture({state: {short_name: "NS"}});
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("NS");
        }
    });

    it("returns 'state' with HT label during half-time", () => {
        const f = fixture({state: {short_name: "HT"}});
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("HT");
        }
    });

    it("returns 'state' with FT label when match is finished", () => {
        const f = fixture({state: {short_name: "FT"}});
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("FT");
        }
    });

    it("falls back to state.state when short_name is absent", () => {
        const f = fixture({state: {state: "INPLAY_1ST"}});
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("INPLAY_1ST");
        }
    });

    it("uses '—' label when both short_name and state are absent", () => {
        const f = fixture({state: {}});
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("—");
        }
    });

    it("uses '—' label when state is absent entirely", () => {
        const f = fixture();
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
        if (mode.kind === "state") {
            expect(mode.label).toBe("—");
        }
    });

    it("ignores non-ticking periods and falls back to state", () => {
        const f = fixture({
            periods: [{ticking: false, minutes: 45, seconds: 0}],
            state: {short_name: "HT"},
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
    });

    it("ignores periods where minutes is non-finite", () => {
        const f = fixture({
            periods: [{ticking: true, minutes: NaN}],
            state: {short_name: "HT"},
        });
        const mode = computeTimerMode(f, 0);
        expect(mode.kind).toBe("state");
    });
});

// ---------------------------------------------------------------------------
// reconcileTimerMode
// ---------------------------------------------------------------------------

describe("reconcileTimerMode", () => {
    const running = (min: number, wallTime: number): Extract<TimerMode, {kind: "running"}> => ({
        kind: "running",
        referenceMinute: min,
        referenceSeconds: 0,
        referenceWallTime: wallTime,
    });

    it("returns next when prev is null", () => {
        const next = running(45, 0);
        expect(reconcileTimerMode(null, next, 0)).toBe(next);
    });

    it("returns next when prev is not running (was 'state')", () => {
        const prev: TimerMode = {kind: "state", label: "HT"};
        const next = running(46, 0);
        expect(reconcileTimerMode(prev, next, 0)).toBe(next);
    });

    it("returns next when next is not running (match ended mid-stream)", () => {
        const prev = running(90, 0);
        const next: TimerMode = {kind: "state", label: "FT"};
        expect(reconcileTimerMode(prev, next, 0)).toBe(next);
    });

    it("keeps prev when drift is within tolerance (smooth ticking)", () => {
        const wallTime = 1_000_000;
        const prev = running(45, wallTime);
        // 30s later, local extrapolation puts us at 45m 30s → minute 45
        const now = wallTime + 30_000;
        // Fresh server frame still says 45 — no drift
        const next = running(45, now);
        expect(reconcileTimerMode(prev, next, now)).toBe(prev);
    });

    it(`snaps to next when drift exceeds ${TIMER_DRIFT_SNAP_MINUTES} minute(s)`, () => {
        const wallTime = 1_000_000;
        const prev = running(40, wallTime);
        // 30s elapsed — local is at ~40m 30s (minute 40)
        const now = wallTime + 30_000;
        // Server says 43 — drift of 3 minutes
        const next = running(43, now);
        expect(reconcileTimerMode(prev, next, now)).toBe(next);
    });

    it("keeps prev when drift equals exactly the snap threshold", () => {
        const wallTime = 1_000_000;
        const prev = running(44, wallTime);
        // 0s elapsed → local is at minute 44
        // next says 45 — drift of exactly 1 min (not strictly greater than threshold)
        const next = running(45, wallTime);
        expect(reconcileTimerMode(prev, next, wallTime)).toBe(prev);
    });
});

// ---------------------------------------------------------------------------
// formatRunningClock
// ---------------------------------------------------------------------------

describe("formatRunningClock", () => {
    const mode = (min: number, sec: number, wallTime: number): Extract<TimerMode, {kind: "running"}> => ({
        kind: "running",
        referenceMinute: min,
        referenceSeconds: sec,
        referenceWallTime: wallTime,
    });

    it("formats MM:SS with zero-padding on seconds", () => {
        const m = mode(5, 3, 0);
        expect(formatRunningClock(m, 0)).toBe("5:03");
    });

    it("accounts for elapsed wall time", () => {
        const m = mode(45, 0, 1_000_000);
        // 90 seconds have passed → 45m 00s + 90s = 46m 30s
        expect(formatRunningClock(m, 1_090_000)).toBe("46:30");
    });

    it("does not go negative when now < referenceWallTime (clamped to 0 elapsed)", () => {
        const m = mode(10, 0, 5_000);
        expect(formatRunningClock(m, 4_000)).toBe("10:00");
    });

    it("allows minutes to overflow past 90 for stoppage time", () => {
        const m = mode(90, 0, 0);
        // 2.5 minutes elapsed → 92:30
        expect(formatRunningClock(m, 150_000)).toBe("92:30");
    });

    it("floors seconds (never reads ahead)", () => {
        // 1.9 seconds elapsed from minute 10:00 → should show 10:01 not 10:02
        const m = mode(10, 0, 0);
        expect(formatRunningClock(m, 1_900)).toBe("10:01");
    });

    it("combines referenceSeconds into the total", () => {
        const m = mode(10, 30, 0);
        expect(formatRunningClock(m, 0)).toBe("10:30");
    });
});

// ---------------------------------------------------------------------------
// formatKickoffTime
// ---------------------------------------------------------------------------

describe("formatKickoffTime", () => {
    it("returns HH:MM for a valid ISO string", () => {
        // Use a specific UTC time that we can control. Since formatKickoffTime
        // uses the local timezone, we parse and reconstruct the expected value.
        const input = "2025-06-01T18:30:00.000Z";
        const date = new Date(input);
        const expected = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
        expect(formatKickoffTime(input)).toBe(expected);
    });

    it("returns '–' for an invalid date string", () => {
        expect(formatKickoffTime("not-a-date")).toBe("–");
    });

    it("returns '–' for an empty string", () => {
        expect(formatKickoffTime("")).toBe("–");
    });

    it("pads single-digit hours and minutes", () => {
        // Use a date that we know will produce single-digit local hours/minutes
        // only if the local tz offset puts us there. We mock it by constructing
        // a date string that matches the test machine's local offset.
        // Instead of fighting timezones, we just verify the format shape.
        const result = formatKickoffTime("2025-01-01T00:05:00.000Z");
        // Must match HH:MM pattern (two digits colon two digits)
        expect(result).toMatch(/^\d{2}:\d{2}$/);
    });
});

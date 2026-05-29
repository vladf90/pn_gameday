import {describe, expect, it} from "vitest";
import {isFixtureFinished, TERMINAL_FIXTURE_STATE_SHORT_NAMES} from "../../../src/sportmonks/isFixtureFinished";
import type {LiveFixture} from "../../../src/sportmonks/types";

// Helper to build a minimal LiveFixture with an arbitrary state.
function makeFixture(state: unknown): LiveFixture {
    return {id: 1, state} as LiveFixture;
}

describe("isFixtureFinished", () => {
    describe("terminal states — returns true", () => {
        const terminalCases: [string, string][] = [
            ["FT", "Full Time"],
            ["AET", "After Extra Time"],
            ["FT_PEN", "Full Time after Penalty shootout"],
            ["CANCL", "Cancelled"],
            ["POSTP", "Postponed"],
            ["ABAN", "Abandoned"],
            ["AWARDED", "Awarded"],
            ["WO", "Walkover"],
        ];

        it.each(terminalCases)("state.short_name = %s (%s)", (shortName) => {
            expect(isFixtureFinished(makeFixture({short_name: shortName}))).toBe(true);
        });
    });

    describe("non-terminal states — returns false", () => {
        const nonTerminalCases: [string, string][] = [
            ["NS", "Not Started"],
            ["INPLAY_1ST_HALF", "In Play 1st Half"],
            ["HT", "Half Time"],
            ["INPLAY_2ND_HALF", "In Play 2nd Half"],
            ["BREAK", "Break"],
            ["INPLAY_ET", "In Play Extra Time"],
            ["INT", "Interrupted"],
            ["SUSPENDED", "Suspended"],
            ["DELAYED", "Delayed"],
            ["TBA", "To Be Announced"],
            ["PENDING", "Pending"],
        ];

        it.each(nonTerminalCases)("state.short_name = %s (%s)", (shortName) => {
            expect(isFixtureFinished(makeFixture({short_name: shortName}))).toBe(false);
        });
    });

    describe("malformed / missing state — always returns false", () => {
        it("returns false when state is null", () => {
            expect(isFixtureFinished(makeFixture(null))).toBe(false);
        });

        it("returns false when state is undefined", () => {
            expect(isFixtureFinished(makeFixture(undefined))).toBe(false);
        });

        it("returns false when state is a string (not an object)", () => {
            expect(isFixtureFinished(makeFixture("FT"))).toBe(false);
        });

        it("returns false when state is a number", () => {
            expect(isFixtureFinished(makeFixture(42))).toBe(false);
        });

        it("returns false when short_name is missing from the state object", () => {
            expect(isFixtureFinished(makeFixture({}))).toBe(false);
        });

        it("returns false when short_name is a number instead of a string", () => {
            expect(isFixtureFinished(makeFixture({short_name: 1}))).toBe(false);
        });

        it("returns false when short_name is null", () => {
            expect(isFixtureFinished(makeFixture({short_name: null}))).toBe(false);
        });

        it("returns false when short_name is an empty string (not in the terminal set)", () => {
            expect(isFixtureFinished(makeFixture({short_name: ""}))).toBe(false);
        });

        it("returns false for a terminal name with wrong casing (ft)", () => {
            expect(isFixtureFinished(makeFixture({short_name: "ft"}))).toBe(false);
        });
    });

    describe("TERMINAL_FIXTURE_STATE_SHORT_NAMES export", () => {
        it("is a ReadonlySet", () => {
            expect(TERMINAL_FIXTURE_STATE_SHORT_NAMES).toBeInstanceOf(Set);
        });

        it("contains all eight documented terminal states", () => {
            const expected = ["FT", "AET", "FT_PEN", "CANCL", "POSTP", "ABAN", "AWARDED", "WO"];
            for (const s of expected) {
                expect(TERMINAL_FIXTURE_STATE_SHORT_NAMES.has(s)).toBe(true);
            }
        });
    });
});

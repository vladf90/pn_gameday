/**
 * Unit tests for FixtureController and its IsoDateOnlyValidator (via
 * GetFixturesByDateValidator).
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

import {
    FixtureController,
    GetFixturesByDateValidator,
} from "../../../src/controller/FixtureController";
import type {FixturesClient} from "../../../src/sportmonks";
import type {UserAuth} from "../../../src/router/UserAuthRouter";

const auth: UserAuth = {
    id: 1,
    username: "alice@example.com",
    role: "user",
    permissions: ["fixture:read"],
};

// ---------------------------------------------------------------------------
// GetFixturesByDateValidator (IsoDateOnlyValidator)
// ---------------------------------------------------------------------------
describe("GetFixturesByDateValidator", () => {
    const v = new GetFixturesByDateValidator();

    it("accepts a valid YYYY-MM-DD string", () => {
        expect(v.validate({date: "2024-06-15"})).toBeNull();
    });

    it("rejects a datetime string with a time component", () => {
        expect(v.validate({date: "2024-06-15T12:00:00Z"})).not.toBeNull();
    });

    it("rejects a date with only two digits for the year", () => {
        expect(v.validate({date: "24-06-15"})).not.toBeNull();
    });

    it("rejects 'today' string", () => {
        expect(v.validate({date: "today"})).not.toBeNull();
    });

    it("rejects an empty string", () => {
        expect(v.validate({date: ""})).not.toBeNull();
    });

    it("rejects an obviously invalid date like 2024-99-99", () => {
        // `Date.parse("2024-99-99")` returns NaN — the validator catches this.
        expect(v.validate({date: "2024-99-99"})).not.toBeNull();
    });

    it("rejects a missing date field", () => {
        expect(v.validate({})).not.toBeNull();
    });

    it("rejects a number as date", () => {
        expect(v.validate({date: 20240615})).not.toBeNull();
    });

    it("returns top-level error for non-object input", () => {
        expect(v.validate("not an object")).toMatchObject({error: "Is not object"});
    });
});

// ---------------------------------------------------------------------------
// FixtureController.getByDate
// ---------------------------------------------------------------------------
describe("FixtureController.getByDate", () => {
    const fixturesClient: FixturesClient = {
        getByDate: vi.fn(),
    } as unknown as FixturesClient;
    const controller = new FixtureController(fixturesClient);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("delegates to fixturesClient.getByDate with the right includes", async () => {
        const fixtures = [{id: 1, name: "Fixture A"}];
        vi.mocked(fixturesClient.getByDate).mockResolvedValue(fixtures);

        const result = await controller.getByDate(auth, {date: "2024-06-15"});

        expect(fixturesClient.getByDate).toHaveBeenCalledWith("2024-06-15", {
            includes: ["participants", "league", "scores", "state"],
        });
        expect(result).toEqual(fixtures);
    });

    it("propagates errors from the fixtures client", async () => {
        vi.mocked(fixturesClient.getByDate).mockRejectedValue(new Error("upstream error"));

        await expect(controller.getByDate(auth, {date: "2024-06-15"})).rejects.toThrow("upstream error");
    });

    it("returns an empty array when client returns []", async () => {
        vi.mocked(fixturesClient.getByDate).mockResolvedValue([]);
        const result = await controller.getByDate(auth, {date: "2024-01-01"});
        expect(result).toEqual([]);
    });
});

/**
 * Component tests for <MatchTimer />.
 *
 * MatchTimer is a pure presentation component — all timer logic lives in
 * common/matchTimer.ts. We drive it with fixed props and assert on the
 * rendered text for each TimerMode kind.
 */
import React from "react";
import {describe, expect, it} from "vitest";
import {screen} from "@testing-library/react";
import {renderWithProviders} from "../../../renderWithProviders";
import {MatchTimer} from "../../../../src/Components/overlay/MatchTimer";
import type {TimerMode} from "../../../../src/common/matchTimer";

describe("<MatchTimer>", () => {
    it("renders the formatted running clock for a 'running' mode", () => {
        // referenceMinute=45, referenceSeconds=0, referenceWallTime=0
        // now=30_000 (30 seconds later) → 45:30
        const mode: TimerMode = {
            kind: "running",
            referenceMinute: 45,
            referenceSeconds: 0,
            referenceWallTime: 0,
        };
        renderWithProviders(<MatchTimer mode={mode} now={30_000} />);
        expect(screen.getByText("45:30")).toBeInTheDocument();
    });

    it("renders 0:00 when the running clock has no elapsed time", () => {
        const mode: TimerMode = {
            kind: "running",
            referenceMinute: 0,
            referenceSeconds: 0,
            referenceWallTime: 0,
        };
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("0:00")).toBeInTheDocument();
    });

    it("renders the kickoff time for a 'kickoff' mode", () => {
        // Construct an ISO string whose local HH:MM we can predict
        const date = new Date();
        date.setHours(19, 30, 0, 0);
        const mode: TimerMode = {kind: "kickoff", startsAt: date.toISOString()};
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("19:30")).toBeInTheDocument();
    });

    it("renders '–' for a kickoff mode with an invalid timestamp", () => {
        const mode: TimerMode = {kind: "kickoff", startsAt: "not-a-date"};
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("–")).toBeInTheDocument();
    });

    it("renders the label for a 'state' mode (HT)", () => {
        const mode: TimerMode = {kind: "state", label: "HT"};
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("HT")).toBeInTheDocument();
    });

    it("renders the label for a 'state' mode (FT)", () => {
        const mode: TimerMode = {kind: "state", label: "FT"};
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("FT")).toBeInTheDocument();
    });

    it("renders the fallback '—' label when the state label is the dash", () => {
        const mode: TimerMode = {kind: "state", label: "—"};
        renderWithProviders(<MatchTimer mode={mode} now={0} />);
        expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("applies the style prop to the wrapper span", () => {
        const mode: TimerMode = {kind: "state", label: "NS"};
        renderWithProviders(
            <MatchTimer mode={mode} now={0} style={{color: "rgb(255, 0, 0)", fontSize: 20}} />,
        );
        const span = screen.getByText("NS");
        expect(span).toHaveStyle({color: "rgb(255, 0, 0)"});
    });

    it("updates the clock display when 'now' advances (stoppage time)", () => {
        const mode: TimerMode = {
            kind: "running",
            referenceMinute: 90,
            referenceSeconds: 0,
            referenceWallTime: 0,
        };
        // 90 seconds into stoppage time → 91:30
        renderWithProviders(<MatchTimer mode={mode} now={90_000} />);
        expect(screen.getByText("91:30")).toBeInTheDocument();
    });
});

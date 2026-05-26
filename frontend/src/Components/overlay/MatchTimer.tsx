import React from "react";
import {TimerMode, formatKickoffTime, formatRunningClock} from "../../common/matchTimer";

interface MatchTimerProps {
    /** Current timer mode for the fixture; produced by `computeTimerMode`
     *  + reconciled by `reconcileTimerMode` in the parent on each SSE frame. */
    mode: TimerMode;
    /** Wall-clock millis from a parent `setInterval(1000)` ticker. Pure prop
     *  so the parent can share one ticker across many fixtures and so this
     *  component stays a pure render. */
    now: number;
    /** Inline style override (e.g. for the OBS overlay's text-shadow). */
    style?: React.CSSProperties;
}

/**
 * Render the per-fixture match clock or state badge (ADR 0006 §3).
 *
 * Strictly a presentation component — all the state-machine logic lives in
 * `common/matchTimer.ts`. Tested by computing the formatted string for each
 * `TimerMode` kind; no React testing infra required for this layer because
 * it's a one-liner per branch.
 */
export const MatchTimer: React.FC<MatchTimerProps> = ({mode, now, style}) => {
    return <span style={style}>{renderTimer(mode, now)}</span>;
};

/**
 * Pure formatter — exported separately from the component so it can be
 * exercised by lightweight string-equality tests once a test runner is
 * wired up (today the repo has none in frontend or backend).
 */
export function renderTimer(mode: TimerMode, now: number): string {
    switch (mode.kind) {
        case "running":
            return formatRunningClock(mode, now);
        case "kickoff":
            return formatKickoffTime(mode.startsAt);
        case "state":
            return mode.label;
    }
}

import {FixtureModel} from "./fixtures";

/**
 * Match-timer mode for the overlay (ADR 0006 §3).
 *
 *   - `running`  — clock is ticking; render as `MM:SS` extrapolated locally
 *                  from a (minute, seconds, wallTime) reference. SportMonks'
 *                  `periods` block is the authoritative source.
 *   - `kickoff`  — match hasn't started; render the scheduled kickoff time
 *                  in the viewer's local timezone (`19:30`).
 *   - `state`    — paused (HT), finished (FT, AET, …), or unknown — render
 *                  the short_name badge as today.
 */
export type TimerMode =
    | {
          kind: "running";
          /** Authoritative minute from the ticking period at the time of capture. */
          referenceMinute: number;
          /** Seconds offset within the minute (often 0 if SportMonks doesn't supply seconds). */
          referenceSeconds: number;
          /** `Date.now()`-style wall time when this reference was captured. */
          referenceWallTime: number;
      }
    | {
          kind: "kickoff";
          /** ISO timestamp of scheduled kickoff. */
          startsAt: string;
      }
    | {
          kind: "state";
          /** Short SportMonks badge to render (e.g. "HT", "FT"). */
          label: string;
      };

/**
 * Drift tolerance when reconciling a fresh `running` mode against a previous
 * one (ADR 0006 §3 — smooth ticking with drift-bound resync). If the new
 * authoritative minute differs from local extrapolation by at most this many
 * minutes, we keep the old reference so the displayed seconds tick smoothly.
 * Beyond that, we snap to the new reference.
 */
export const TIMER_DRIFT_SNAP_MINUTES = 1;

/**
 * Build a `TimerMode` from a fixture snapshot. Pure function of the snapshot
 * and the server's wall time — never reads `Date.now()` so behaviour is
 * deterministic from inputs (essential for fake-clock testing later).
 *
 * `serverTime` is the epoch-ms the SSE frame was emitted by the backend
 * (ADR 0006 §1). We use it as the wall-time anchor for `running` modes so
 * client clock skew doesn't bias the displayed seconds.
 */
export function computeTimerMode(fixture: FixtureModel, serverTime: number): TimerMode {
    const ticking = (fixture.periods ?? []).find(p => p.ticking === true);
    if (ticking !== undefined && typeof ticking.minutes === "number" && Number.isFinite(ticking.minutes)) {
        const seconds = typeof ticking.seconds === "number" && Number.isFinite(ticking.seconds)
            ? Math.max(0, Math.min(59, Math.floor(ticking.seconds)))
            : 0;
        return {
            kind: "running",
            referenceMinute: Math.max(0, Math.floor(ticking.minutes)),
            referenceSeconds: seconds,
            referenceWallTime: serverTime,
        };
    }

    const shortName = fixture.state?.short_name ?? fixture.state?.state;

    // Pre-match: render the kickoff time so the viewer knows when to expect
    // the match. Falls back to the state badge if `starting_at` is missing.
    if ((shortName === "NS" || shortName === "TBA") && fixture.starting_at) {
        return {kind: "kickoff", startsAt: fixture.starting_at};
    }

    return {kind: "state", label: shortName ?? "—"};
}

/**
 * Decide whether to adopt a freshly-computed `TimerMode` or keep the previous
 * reference (ADR 0006 §3). Smooth ticking is preferred — we only snap when:
 *   - the previous mode was not `running` (no smoothing to preserve), or
 *   - the new mode is not `running` (the match state changed), or
 *   - drift between local extrapolation and the new authoritative minute
 *     exceeds `TIMER_DRIFT_SNAP_MINUTES`.
 *
 * The returned object is reference-equal to `prev` in the smooth case so a
 * `useMemo` or `useState` parent can avoid spurious re-renders.
 */
export function reconcileTimerMode(
    prev: TimerMode | null,
    next: TimerMode,
    now: number,
): TimerMode {
    if (prev === null || prev.kind !== "running" || next.kind !== "running") {
        return next;
    }
    // Local extrapolation: where would the previous reference put the
    // minute hand right now? Compare against the new authoritative minute.
    const elapsedSeconds = Math.max(0, (now - prev.referenceWallTime) / 1000);
    const localTotalSeconds = prev.referenceMinute * 60 + prev.referenceSeconds + elapsedSeconds;
    const localMinute = Math.floor(localTotalSeconds / 60);
    const drift = Math.abs(next.referenceMinute - localMinute);
    if (drift > TIMER_DRIFT_SNAP_MINUTES) {
        return next;
    }
    return prev;
}

/**
 * Format a `running` mode as `MM:SS` at wall-time `now`.
 *
 * Seconds are floor()'d so the display never reads ahead of the true
 * elapsed wall time. We allow minutes to exceed the reference (overflow is
 * how stoppage time naturally appears as `90:42`, `91:15`, …).
 */
export function formatRunningClock(
    mode: Extract<TimerMode, {kind: "running"}>,
    now: number,
): string {
    const elapsedSeconds = Math.max(0, (now - mode.referenceWallTime) / 1000);
    const totalSeconds = Math.floor(mode.referenceMinute * 60 + mode.referenceSeconds + elapsedSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format a kickoff timestamp as `HH:MM` in the viewer's local timezone.
 * Returns the literal string `"–"` if parsing fails so the overlay never
 * shows `NaN:NaN` or `Invalid Date`.
 */
export function formatKickoffTime(startsAt: string): string {
    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime())) {
        return "–";
    }
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

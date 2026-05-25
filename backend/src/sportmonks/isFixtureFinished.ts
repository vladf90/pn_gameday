import {LiveFixture} from "./types";

/**
 * SportMonks fixture-state short names that mean "this fixture is over and
 * will not resume." Used by `SessionAutoCloser` to decide when a session can
 * be marked ended (ADR 0005 §2).
 *
 * Source: SportMonks states reference. We deliberately treat scheduled-but-
 * cancelled / postponed / abandoned outcomes as terminal too — the host's
 * watchalong cannot proceed against a fixture that won't be played, and
 * leaving the session "active forever" because the upstream is in `POSTP`
 * defeats the lifecycle.
 *
 * Non-terminal states (kept here as comments for grepability):
 *   - NS (Not Started), INPLAY_1ST_HALF, HT, INPLAY_2ND_HALF, BREAK,
 *     INPLAY_ET, INPLAY_ET_2ND_HALF, INPLAY_PENALTIES, PEN_BREAK,
 *     EXTRA_TIME_BREAK, INT (Interrupted), SUSPENDED, AWARDED_AFTER_DELAY,
 *     DELAYED, START_DELAYED, TBA, REFEREES_ABANDONED, PENDING.
 */
const TERMINAL_STATE_SHORT_NAMES: ReadonlySet<string> = new Set([
    "FT",       // Full Time
    "AET",      // After Extra Time
    "FT_PEN",   // Full Time after Penalty shootout
    "CANCL",    // Cancelled
    "POSTP",    // Postponed
    "ABAN",     // Abandoned
    "AWARDED",  // Awarded (e.g. opponent forfeit, decided off-field)
    "WO",       // Walkover
]);

/**
 * Returns `true` when the given live snapshot's `state.short_name` indicates
 * a terminal SportMonks fixture state. Returns `false` for non-terminal
 * states, missing state, and any malformed shape — the contract is "I will
 * only return `true` when I am confident the fixture is over."
 *
 * `LiveFixture.state` is typed as `unknown` (the poller passes the include
 * block through verbatim), so this helper parses defensively rather than
 * casting.
 */
export function isFixtureFinished(fixture: LiveFixture): boolean {
    const state = fixture.state;
    if (state === null || state === undefined || typeof state !== "object") {
        return false;
    }
    const shortName = (state as {short_name?: unknown}).short_name;
    if (typeof shortName !== "string") {
        return false;
    }
    return TERMINAL_STATE_SHORT_NAMES.has(shortName);
}

/**
 * Re-exported so callers (and future tests) can inspect the terminal set
 * without duplicating it. ReadonlySet enforces immutability at the type
 * level.
 */
export const TERMINAL_FIXTURE_STATE_SHORT_NAMES = TERMINAL_STATE_SHORT_NAMES;

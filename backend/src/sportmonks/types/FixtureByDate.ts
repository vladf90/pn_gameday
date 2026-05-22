import {Fixture} from "./Fixture";

/**
 * Fixture shape returned by `GET /fixtures/date/{date}` with the includes
 * the public day-view endpoint asks for (`participants;league;scores;state`).
 * Per-include blocks are opaque pass-throughs so we don't mirror the full
 * upstream schema — kept separate from `LiveFixture` to avoid coupling to
 * the poller's set of includes.
 */
export interface FixtureByDate extends Fixture {
    participants?: unknown;
    league?: unknown;
    scores?: unknown;
    state?: unknown;
}

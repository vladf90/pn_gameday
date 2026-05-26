import {Fixture} from "./Fixture";

/**
 * Fixture shape returned by `GET /fixtures/multi/{ids}` with the includes
 * the live poller asks for (`scores;state;events;participants;statistics`).
 * Inherits base fixture fields from `Fixture` and adds the per-include
 * blocks as opaque pass-throughs — downstream consumers render whatever
 * SportMonks returns without us mirroring the full upstream schema.
 */
export interface LiveFixture extends Fixture {
    /** `include=scores` block, passed through verbatim. */
    scores?: unknown;
    /** `include=state` block, passed through verbatim. */
    state?: unknown;
    /** `include=events` block, passed through verbatim. */
    events?: unknown;
    /** `include=participants` block, passed through verbatim. */
    participants?: unknown;
    /** `include=statistics` block, passed through verbatim. */
    statistics?: unknown;
    /** `include=periods` block (ADR 0006). The ticking period carries the
     *  live match minute consumed by the frontend overlay timer. */
    periods?: unknown;
}

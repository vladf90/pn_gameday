/**
 * Minimal in-memory representation of a fixture's live state as returned
 * by `GET /fixtures/multi/{ids}?include=scores;state;events;participants;statistics`.
 *
 * We deliberately keep the shape thin: only `id` is required for the
 * `LiveSnapshotStore` to key entries, and `name` is the one human-friendly
 * field that SportMonks surfaces at the top level once `participants` is
 * included (typically "Team A vs Team B"). Everything else is passed through
 * as opaque blocks so downstream consumers can render whatever SportMonks
 * returns without us having to mirror the full upstream schema.
 *
 * TODO: tighten the pass-through field types when issues #7 (FixturePoller)
 * and #8 (`GET /sessions/:id/live`) land and the concrete shape needed by
 * those consumers is known.
 */
export interface LiveFixture {
    /** SportMonks fixture ID — the map key in `LiveSnapshotStore`. */
    id: number;
    /**
     * Human-readable name SportMonks builds from the included participants
     * (e.g. "Team A vs Team B"). Optional because the include may be absent
     * or the upstream may omit it.
     */
    name?: string;
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
}

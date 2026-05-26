/**
 * Shapes for the public /fixtures?date=... response.
 * Fields mirror the SportMonks v3 payload with `include=participants;league;scores;state`.
 * Everything is optional because SportMonks omits empty/inapplicable blocks
 * (pre-match fixtures have no scores, etc.).
 */

export interface FixtureLeague {
    id: number;
    name?: string;
    image_path?: string;
    country_id?: number;
    short_code?: string;
}

export interface FixtureParticipantMeta {
    location?: "home" | "away";
}

export interface FixtureParticipant {
    id: number;
    name?: string;
    short_code?: string;
    image_path?: string;
    meta?: FixtureParticipantMeta;
}

export interface FixtureScoreEntry {
    description?: string;
    score?: {
        goals?: number;
        participant?: "home" | "away";
    };
}

export interface FixtureState {
    id?: number;
    state?: string;
    name?: string;
    short_name?: string;
}

/**
 * One entry of the SportMonks `periods` include. The current/ticking period
 * is the one with `ticking: true`; that's where the live match minute comes
 * from (ADR 0006). `minutes` is the authoritative server-reported minute;
 * `seconds` may or may not be populated depending on the upstream feed.
 */
export interface FixturePeriod {
    id?: number;
    type_id?: number;
    minutes?: number;
    seconds?: number;
    ticking?: boolean;
    description?: string;
}

export interface FixtureModel {
    id: number;
    name?: string;
    starting_at?: string;
    league_id?: number;
    season_id?: number;
    participants?: FixtureParticipant[];
    league?: FixtureLeague;
    scores?: FixtureScoreEntry[];
    state?: FixtureState;
    periods?: FixturePeriod[];
}

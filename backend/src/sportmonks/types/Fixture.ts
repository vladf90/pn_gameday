/**
 * Minimal Fixture DTO — the base shape `FixturesClient` returns from every
 * endpoint that yields fixtures. Extend (e.g. `LiveFixture`) when a caller
 * needs the shape of specific `include` blocks.
 */
export interface Fixture {
    id: number;
    name?: string;
    starting_at?: string;
    league_id?: number;
    season_id?: number;
}

/**
 * Valid keys for the `include` query parameter on Fixtures endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/fixtures
 */
export type FixtureInclude =
    | "sport"
    | "round"
    | "stage"
    | "group"
    | "aggregate"
    | "league"
    | "season"
    | "coaches"
    | "tvStations"
    | "venue"
    | "state"
    | "weatherReport"
    | "lineups"
    | "events"
    | "timeline"
    | "comments"
    | "trends"
    | "statistics"
    | "periods"
    | "participants"
    | "odds"
    | "premiumOdds"
    | "inplayOdds"
    | "prematchNews"
    | "postmatchNews"
    | "metadata"
    | "sidelined"
    | "predictions"
    | "referees"
    | "formations"
    | "ballCoordinates"
    | "scores"
    | "xGFixture"
    | "pressure"
    | "expectedLineups";

import {Fixture} from "./Fixture";

/**
 * Livescore DTO. SportMonks v3 livescores share the Fixture shape — they
 * are the same entity returned by a different lens (±15 min of kick-off /
 * final whistle, or strictly in-play, or last 10 s updated).
 */
export type Livescore = Fixture;

/**
 * Valid keys for the `include` query parameter on Livescores endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/livescores
 *
 * Note vs `FixtureInclude`: livescores do **not** support `odds`,
 * `premiumOdds`; they do support `predictedLineups`.
 */
export type LivescoreInclude =
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
    | "expectedLineups"
    | "predictedLineups";

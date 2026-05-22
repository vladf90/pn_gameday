/**
 * Minimal Statistic DTO. The exact response shape varies per endpoint
 * (season-by-participant vs stage vs round); callers narrow `T` when they
 * know the include set they requested.
 */
export interface Statistic {
    id: number;
    [k: string]: unknown;
}

/**
 * Participant type accepted by `GET /statistics/seasons/{participant}/{id}`.
 */
export type StatisticParticipantType =
    | "players"
    | "teams"
    | "coaches"
    | "referees";

/**
 * Valid keys for the `include` query parameter on Statistics endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/statistics
 *
 * Note: not every key is valid on every endpoint —
 *   - Season by participant: `player`, `season`, `coach`, `team`, `referee`, `position`
 *   - Stage / round: `statistics`, `statistics.type`
 * SportMonks ignores unsupported keys silently.
 */
export type StatisticInclude =
    | "player"
    | "season"
    | "coach"
    | "team"
    | "referee"
    | "position"
    | "statistics"
    | "statistics.type";

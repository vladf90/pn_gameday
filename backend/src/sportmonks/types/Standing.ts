/**
 * Minimal Standing DTO. SportMonks returns one entry per
 * (season, league, group, participant); the shape varies by endpoint.
 */
export interface Standing {
    id?: number;
    position?: number;
    points?: number;
    participant_id?: number;
    season_id?: number;
    [k: string]: unknown;
}

/**
 * Valid keys for the `include` query parameter on Standings endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/standings
 */
export type StandingInclude =
    | "participant"
    | "season"
    | "league"
    | "stage"
    | "group"
    | "round"
    | "rule"
    | "details"
    | "form"
    | "sport";

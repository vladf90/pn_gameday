/**
 * Minimal Topscorer DTO. SportMonks distinguishes goal-scorers,
 * assist-providers and yellow/red-card leaders via `type_id`.
 */
export interface Topscorer {
    id?: number;
    season_id?: number;
    player_id?: number;
    type_id?: number;
    position?: number;
    total?: number;
    participant_id?: number;
    [k: string]: unknown;
}

/**
 * Valid keys for the `include` query parameter on Topscorers endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/topscorers
 */
export type TopscorerInclude =
    | "season"
    | "stage"
    | "player"
    | "team"
    | "type";

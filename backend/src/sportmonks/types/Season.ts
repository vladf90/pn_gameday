/**
 * Minimal Season DTO returned by `SeasonsClient`.
 */
export interface Season {
    id: number;
    name?: string;
    league_id?: number;
    is_current?: boolean;
    starting_at?: string;
    ending_at?: string;
}

/**
 * Valid keys for the `include` query parameter on Seasons endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/seasons
 */
export type SeasonInclude =
    | "sport"
    | "league"
    | "teams"
    | "stages"
    | "currentStage"
    | "fixtures"
    | "groups"
    | "statistics"
    | "topscorers";

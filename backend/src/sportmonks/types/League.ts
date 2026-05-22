/**
 * Minimal League DTO returned by `LeaguesClient`. Extend when callers
 * need fields like `category`, `is_cup`, etc.
 */
export interface League {
    id: number;
    name?: string;
    short_code?: string;
    country_id?: number;
    image_path?: string;
}

/**
 * Valid keys for the `include` query parameter on Leagues endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/leagues
 */
export type LeagueInclude =
    | "sport"
    | "country"
    | "stages"
    | "currentSeason"
    | "seasons"
    | "latest"
    | "upcoming"
    | "inplay"
    | "today";

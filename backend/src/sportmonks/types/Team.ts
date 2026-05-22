/**
 * Minimal Team DTO returned by `TeamsClient`.
 */
export interface Team {
    id: number;
    name?: string;
    short_code?: string;
    country_id?: number;
    venue_id?: number;
    image_path?: string;
    founded?: number;
}

/**
 * Valid keys for the `include` query parameter on Teams endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/teams
 */
export type TeamInclude =
    | "sport"
    | "country"
    | "venue"
    | "coaches"
    | "rivals"
    | "players"
    | "latest"
    | "upcoming"
    | "seasons"
    | "activeSeasons"
    | "sidelined"
    | "sidelinedHistory"
    | "statistics"
    | "trophies"
    | "socials";

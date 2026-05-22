/**
 * Minimal Player DTO returned by `PlayersClient`.
 */
export interface Player {
    id: number;
    name?: string;
    common_name?: string;
    display_name?: string;
    country_id?: number;
    nationality_id?: number;
    position_id?: number;
    image_path?: string;
}

/**
 * Valid keys for the `include` query parameter on Players endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/players
 */
export type PlayerInclude =
    | "sport"
    | "country"
    | "city"
    | "nationality"
    | "transfers"
    | "pendingTransfers"
    | "teams"
    | "statistics"
    | "latest"
    | "position"
    | "detailedPosition"
    | "lineups"
    | "trophies"
    | "metadata";

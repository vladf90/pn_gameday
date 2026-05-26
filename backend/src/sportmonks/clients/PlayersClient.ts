import {Player, PlayerInclude} from "../types/Player";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface PlayersQueryOptions {
    includes?: PlayerInclude[];
}

/**
 * Typed wrapper for the SportMonks v3 Players endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/players
 */
export class PlayersClient {

    private readonly entity = "Player";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /players` — all players within the subscription. */
    getAll<T extends Player = Player>(opts: PlayersQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/players", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /players/{id}` — single player by ID. */
    getById<T extends Player = Player>(id: number, opts: PlayersQueryOptions = {}): Promise<T> {
        return this.http.get<T>(`/players/${id}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /players/countries/{countryId}` — players from a country. */
    getByCountry<T extends Player = Player>(countryId: number, opts: PlayersQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/players/countries/${countryId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /players/search/{name}` — players matching a search query. */
    search<T extends Player = Player>(name: string, opts: PlayersQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/players/search/${encodeURIComponent(name)}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /players/latest` — players updated in the past ~2 h. */
    getLatest<T extends Player = Player>(opts: PlayersQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/players/latest", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    private buildQuery(includes?: PlayerInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

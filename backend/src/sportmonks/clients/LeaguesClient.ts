import {League, LeagueInclude} from "../types/League";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface LeaguesQueryOptions {
    includes?: LeagueInclude[];
}

/**
 * Typed wrapper for the SportMonks v3 Leagues endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/leagues
 */
export class LeaguesClient {

    private readonly entity = "League";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /leagues` — all leagues within the subscription. */
    getAll<T extends League = League>(opts: LeaguesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/leagues", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /leagues/{id}` — single league by ID. */
    getById<T extends League = League>(id: number, opts: LeaguesQueryOptions = {}): Promise<T> {
        return this.http.get<T>(`/leagues/${id}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /leagues/live` — leagues currently with live fixtures. */
    getLive<T extends League = League>(opts: LeaguesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/leagues/live", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /leagues/between/{start}/{end}` — leagues with fixtures in a date range. */
    getByDateRange<T extends League = League>(
        start: string,
        end: string,
        opts: LeaguesQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/leagues/between/${start}/${end}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /leagues/countries/{countryId}` — leagues for a country. */
    getByCountry<T extends League = League>(countryId: number, opts: LeaguesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/leagues/countries/${countryId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /leagues/search/{name}` — leagues matching a search query. */
    search<T extends League = League>(name: string, opts: LeaguesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/leagues/search/${encodeURIComponent(name)}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    private buildQuery(includes?: LeagueInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

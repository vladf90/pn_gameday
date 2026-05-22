import {Context} from "../../Logger/Context";
import {Team, TeamInclude} from "../types/Team";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface TeamsQueryOptions {
    includes?: TeamInclude[];
    ctx?: Context;
}

/**
 * Typed wrapper for the SportMonks v3 Teams endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/teams
 */
export class TeamsClient {

    private readonly entity = "Team";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /teams` — all teams within the subscription. */
    getAll<T extends Team = Team>(opts: TeamsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/teams", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /teams/{id}` — single team by ID. */
    getById<T extends Team = Team>(id: number, opts: TeamsQueryOptions = {}): Promise<T> {
        return this.http.get<T>(`/teams/${id}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /teams/countries/{countryId}` — teams from a country. */
    getByCountry<T extends Team = Team>(countryId: number, opts: TeamsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/teams/countries/${countryId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /teams/seasons/{seasonId}` — teams competing in a season. */
    getBySeason<T extends Team = Team>(seasonId: number, opts: TeamsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/teams/seasons/${seasonId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /teams/search/{name}` — teams matching a search query. */
    search<T extends Team = Team>(name: string, opts: TeamsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/teams/search/${encodeURIComponent(name)}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    private buildQuery(includes?: TeamInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

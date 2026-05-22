import {Context} from "../../Logger/Context";
import {Season, SeasonInclude} from "../types/Season";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface SeasonsQueryOptions {
    includes?: SeasonInclude[];
    ctx?: Context;
}

/**
 * Typed wrapper for the SportMonks v3 Seasons endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/seasons
 */
export class SeasonsClient {

    private readonly entity = "Season";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /seasons` — all historical and active seasons in the subscription. */
    getAll<T extends Season = Season>(opts: SeasonsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/seasons", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /seasons/{id}` — single season by ID. */
    getById<T extends Season = Season>(id: number, opts: SeasonsQueryOptions = {}): Promise<T> {
        return this.http.get<T>(`/seasons/${id}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /seasons/search/{name}` — seasons matching a search query. */
    search<T extends Season = Season>(name: string, opts: SeasonsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/seasons/search/${encodeURIComponent(name)}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    private buildQuery(includes?: SeasonInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

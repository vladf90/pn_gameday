import {Context} from "../../Logger/Context";
import {Standing, StandingInclude} from "../types/Standing";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface StandingsQueryOptions {
    includes?: StandingInclude[];
    ctx?: Context;
}

/**
 * Typed wrapper for the SportMonks v3 Standings endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/standings
 */
export class StandingsClient {

    private readonly entity = "Standing";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /standings` — all standings within the subscription. */
    getAll<T extends Standing = Standing>(opts: StandingsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/standings", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /standings/seasons/{seasonId}` — full league table for a season. */
    getBySeason<T extends Standing = Standing>(seasonId: number, opts: StandingsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/standings/seasons/${seasonId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /standings/rounds/{roundId}` — table after a specific round. */
    getByRound<T extends Standing = Standing>(roundId: number, opts: StandingsQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/standings/rounds/${roundId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /standings/corrections/seasons/{seasonId}` — corrections applied to a season's table. */
    getCorrectionsBySeason<T extends Standing = Standing>(
        seasonId: number,
        opts: StandingsQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/standings/corrections/seasons/${seasonId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /standings/live/leagues/{leagueId}` — LIVE table for a league. */
    getLiveByLeague<T extends Standing = Standing>(
        leagueId: number,
        opts: StandingsQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/standings/live/leagues/${leagueId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    private buildQuery(includes?: StandingInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

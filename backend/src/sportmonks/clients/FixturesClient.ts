import {Fixture, FixtureInclude} from "../types/Fixture";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface FixturesQueryOptions {
    includes?: FixtureInclude[];
}

/**
 * Typed wrapper for the SportMonks v3 Fixtures endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/fixtures
 *
 * The optional generic `T extends Fixture` lets callers narrow the return
 * shape when they know which `include` blocks they asked for — e.g. the
 * fixture poller passes `LiveFixture` because it always requests
 * `scores;state;events;participants;statistics`.
 */
export class FixturesClient {

    private readonly entity = "Fixture";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /fixtures` — all fixtures within the subscription. */
    getAll<T extends Fixture = Fixture>(opts: FixturesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/fixtures", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/{id}` — single fixture by ID. */
    getById<T extends Fixture = Fixture>(id: number, opts: FixturesQueryOptions = {}): Promise<T> {
        return this.http.get<T>(`/fixtures/${id}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/multi/{ids}` — multiple fixtures in one call (capped server-side at ~50). */
    getMulti<T extends Fixture = Fixture>(ids: number[], opts: FixturesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/multi/${ids.join(",")}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/date/{date}` — fixtures on a single date (`YYYY-MM-DD`). */
    getByDate<T extends Fixture = Fixture>(date: string, opts: FixturesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/date/${date}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/between/{start}/{end}` — fixtures in a date range. */
    getByDateRange<T extends Fixture = Fixture>(
        start: string,
        end: string,
        opts: FixturesQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/between/${start}/${end}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/between/{start}/{end}/{teamId}` — date-range, narrowed to a team. */
    getByDateRangeForTeam<T extends Fixture = Fixture>(
        start: string,
        end: string,
        teamId: number,
        opts: FixturesQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(
            `/fixtures/between/${start}/${end}/${teamId}`,
            this.buildQuery(opts.includes),
            {entity: this.entity},
        );
    }

    /** `GET /fixtures/head-to-head/{teamA}/{teamB}` — historical head-to-heads. */
    getHeadToHead<T extends Fixture = Fixture>(
        teamA: number,
        teamB: number,
        opts: FixturesQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/head-to-head/${teamA}/${teamB}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/search/{name}` — fixtures matching a search query. */
    search<T extends Fixture = Fixture>(name: string, opts: FixturesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/search/${encodeURIComponent(name)}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/upcoming/markets/{marketId}` — upcoming fixtures by market. */
    getUpcomingByMarket<T extends Fixture = Fixture>(
        marketId: number,
        opts: FixturesQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/fixtures/upcoming/markets/${marketId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /fixtures/latest` — fixtures updated in the past ~10 s. */
    getLatest<T extends Fixture = Fixture>(opts: FixturesQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/fixtures/latest", this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    private buildQuery(includes?: FixtureInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

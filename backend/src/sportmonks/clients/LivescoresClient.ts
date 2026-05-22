import {Context} from "../../Logger/Context";
import {Livescore, LivescoreInclude} from "../types/Livescore";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface LivescoresQueryOptions {
    includes?: LivescoreInclude[];
    ctx?: Context;
}

/**
 * Typed wrapper for the SportMonks v3 Livescores endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/livescores
 */
export class LivescoresClient {

    private readonly entity = "Livescore";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /livescores` — fixtures within ±15 min of kick-off / final whistle. */
    getAll<T extends Livescore = Livescore>(opts: LivescoresQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/livescores", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /livescores/inplay` — fixtures currently in play. */
    getInplay<T extends Livescore = Livescore>(opts: LivescoresQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/livescores/inplay", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /livescores/latest` — livescores updated within the past ~10 s. */
    getLatest<T extends Livescore = Livescore>(opts: LivescoresQueryOptions = {}): Promise<T[]> {
        return this.http.get<T[]>("/livescores/latest", this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    private buildQuery(includes?: LivescoreInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

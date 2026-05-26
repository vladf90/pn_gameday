import {Topscorer, TopscorerInclude} from "../types/Topscorer";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface TopscorersQueryOptions {
    includes?: TopscorerInclude[];
}

/**
 * Typed wrapper for the SportMonks v3 Topscorers endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/topscorers
 */
export class TopscorersClient {

    private readonly entity = "Topscorer";

    constructor(private readonly http: SportmonksHttpClient) {}

    /** `GET /topscorers/seasons/{seasonId}` — top scorers for a season. */
    getBySeason<T extends Topscorer = Topscorer>(
        seasonId: number,
        opts: TopscorersQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/topscorers/seasons/${seasonId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    /** `GET /topscorers/stages/{stageId}` — top scorers for a stage. */
    getByStage<T extends Topscorer = Topscorer>(
        stageId: number,
        opts: TopscorersQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(`/topscorers/stages/${stageId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
        });
    }

    private buildQuery(includes?: TopscorerInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

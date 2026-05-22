import {Context} from "../../Logger/Context";
import {Statistic, StatisticInclude, StatisticParticipantType} from "../types/Statistic";
import {SportmonksHttpClient} from "./SportmonksHttpClient";

export interface StatisticsQueryOptions {
    includes?: StatisticInclude[];
    ctx?: Context;
}

/**
 * Typed wrapper for the SportMonks v3 Statistics endpoints.
 * Source: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/statistics
 */
export class StatisticsClient {

    private readonly entity = "Statistic";

    constructor(private readonly http: SportmonksHttpClient) {}

    /**
     * `GET /statistics/seasons/{participant}/{id}` — season statistics for
     * a specific participant (player, team, coach, or referee).
     */
    getSeasonStatisticsByParticipant<T extends Statistic = Statistic>(
        participantType: StatisticParticipantType,
        participantId: number,
        opts: StatisticsQueryOptions = {},
    ): Promise<T[]> {
        return this.http.get<T[]>(
            `/statistics/seasons/${participantType}/${participantId}`,
            this.buildQuery(opts.includes),
            {entity: this.entity, ctx: opts.ctx},
        );
    }

    /** `GET /statistics/stages/{stageId}` — aggregated stats for a stage. */
    getStageStatistics<T extends Statistic = Statistic>(
        stageId: number,
        opts: StatisticsQueryOptions = {},
    ): Promise<T> {
        return this.http.get<T>(`/statistics/stages/${stageId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    /** `GET /statistics/rounds/{roundId}` — aggregated stats for a round. */
    getRoundStatistics<T extends Statistic = Statistic>(
        roundId: number,
        opts: StatisticsQueryOptions = {},
    ): Promise<T> {
        return this.http.get<T>(`/statistics/rounds/${roundId}`, this.buildQuery(opts.includes), {
            entity: this.entity,
            ctx: opts.ctx,
        });
    }

    private buildQuery(includes?: StatisticInclude[]): Record<string, string> | undefined {
        if (!includes || includes.length === 0) {
            return undefined;
        }
        return {include: includes.join(";")};
    }
}

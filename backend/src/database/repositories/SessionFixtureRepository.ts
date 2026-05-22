import { Repository } from "typeorm";
import { SessionFixture } from "../entities/SessionFixture";
import { AppDataSource } from "../data-source";

export class SessionFixtureRepository {
    private repository: Repository<SessionFixture>;

    constructor() {
        this.repository = AppDataSource.getRepository(SessionFixture);
    }

    async findBySession(sessionId: number): Promise<SessionFixture[]> {
        return this.repository.find({
            where: { sessionId },
            order: { sportmonksFixtureId: "ASC" },
        });
    }

    async findOne(sessionId: number, sportmonksFixtureId: number): Promise<SessionFixture | null> {
        return this.repository.findOne({ where: { sessionId, sportmonksFixtureId } });
    }

    async attach(sessionId: number, sportmonksFixtureId: number): Promise<SessionFixture> {
        const fixture = new SessionFixture();
        fixture.sessionId = sessionId;
        fixture.sportmonksFixtureId = sportmonksFixtureId;
        return this.repository.save(fixture);
    }

    async detach(sessionId: number, sportmonksFixtureId: number): Promise<boolean> {
        const result = await this.repository.delete({ sessionId, sportmonksFixtureId });
        return (result.affected ?? 0) > 0;
    }

    /**
     * Returns the deduped union of every `sportmonks_fixture_id` referenced by any
     * session. Used by the SportMonks poller to determine which upstream fixtures
     * still need to be tracked.
     */
    async findAllSportmonksFixtureIds(): Promise<number[]> {
        const rows = await this.repository
            .createQueryBuilder("sf")
            .select("DISTINCT sf.sportmonks_fixture_id", "sportmonks_fixture_id")
            .getRawMany<{ sportmonks_fixture_id: string | number }>();
        return rows.map(row => Number(row.sportmonks_fixture_id));
    }

    /**
     * Returns the deduped, ascending list of `sportmonks_fixture_id` values
     * attached to a single session. Used by `GET /sessions/:id/live` to look
     * up entries in the in-memory snapshot store without issuing a SportMonks
     * call. The composite PK on `(session_id, sportmonks_fixture_id)` already
     * guarantees uniqueness per-session, so the DISTINCT is defensive.
     */
    async findSportmonksFixtureIdsBySessionId(sessionId: number): Promise<number[]> {
        const rows = await this.repository
            .createQueryBuilder("sf")
            .select("DISTINCT sf.sportmonks_fixture_id", "sportmonks_fixture_id")
            .where("sf.session_id = :sessionId", { sessionId })
            .orderBy("sportmonks_fixture_id", "ASC")
            .getRawMany<{ sportmonks_fixture_id: string | number }>();
        return rows.map(row => Number(row.sportmonks_fixture_id));
    }
}

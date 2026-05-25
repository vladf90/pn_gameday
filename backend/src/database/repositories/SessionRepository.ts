import { FindOptionsWhere, IsNull, Not, Repository } from "typeorm";
import { Session } from "../entities/Session";
import { AppDataSource } from "../data-source";

export type SessionStatusFilter = 'active' | 'ended' | 'all';

export class SessionRepository {
    private repository: Repository<Session>;

    constructor() {
        this.repository = AppDataSource.getRepository(Session);
    }

    /**
     * List sessions owned by `userId`, filtered by lifecycle status.
     *
     * `'active'` (the default in the controller) uses the partial index
     * `IDX_session_user_active` for an O(active) scan; `'ended'` falls back
     * to a regular index lookup; `'all'` is a plain owner-scoped query.
     */
    async findByUserAndStatus(userId: number, status: SessionStatusFilter): Promise<Session[]> {
        const where: FindOptionsWhere<Session> = { userId };
        if (status === 'active') {
            where.endedAt = IsNull();
        } else if (status === 'ended') {
            where.endedAt = Not(IsNull());
        }
        return this.repository.find({ where, order: { id: "ASC" } });
    }

    /**
     * Owner-scoped lookup. Returns `null` when the session doesn't exist OR
     * belongs to a different user — controllers should treat both as 404 to
     * avoid leaking session existence across users (ADR 0005).
     */
    async findByIdForUser(id: number, userId: number): Promise<Session | null> {
        return this.repository.findOne({ where: { id, userId } });
    }

    /**
     * Public read for the OBS overlay endpoint (ADR 0005 §4). Looks up a
     * session by id with **no user filter** — the URL itself is the capability.
     */
    async findByIdPublic(id: number): Promise<Session | null> {
        return this.repository.findOne({ where: { id } });
    }

    /**
     * Returns every active session with its attached fixture IDs, grouped.
     * Used by `SessionAutoCloser` (ADR 0005 §2) to evaluate the
     * "all-fixtures-finished" predicate. Includes sessions with zero
     * attached fixtures so the caller can skip them explicitly (an empty
     * fixture set must NEVER auto-end — the closer enforces that).
     *
     * Two queries on purpose: the first uses the partial index
     * `IDX_session_user_active`; the second is a single `IN` lookup on the
     * `session_fixture` PK's leading column. No `ARRAY_AGG` so the code
     * stays DB-portable beyond Postgres.
     */
    async findActiveWithFixtureIds(): Promise<ActiveSessionWithFixtures[]> {
        const sessions = await this.repository.find({
            where: { endedAt: IsNull() },
            select: { id: true, userId: true },
            order: { id: "ASC" },
        });
        if (sessions.length === 0) {
            return [];
        }

        const sessionIds = sessions.map(s => s.id);
        const rows = await this.repository.manager
            .createQueryBuilder()
            .select("sf.session_id", "session_id")
            .addSelect("sf.sportmonks_fixture_id", "sportmonks_fixture_id")
            .from("session_fixture", "sf")
            .where("sf.session_id IN (:...sessionIds)", { sessionIds })
            .orderBy("sf.session_id", "ASC")
            .addOrderBy("sf.sportmonks_fixture_id", "ASC")
            .getRawMany<{ session_id: number | string; sportmonks_fixture_id: number | string }>();

        const fixturesBySession = new Map<number, number[]>();
        for (const row of rows) {
            const sessionId = Number(row.session_id);
            const list = fixturesBySession.get(sessionId) ?? [];
            list.push(Number(row.sportmonks_fixture_id));
            fixturesBySession.set(sessionId, list);
        }

        return sessions.map(s => ({
            sessionId: s.id,
            userId: s.userId,
            fixtureIds: fixturesBySession.get(s.id) ?? [],
        }));
    }

    async create(userId: number, name: string): Promise<Session> {
        const session = new Session();
        session.userId = userId;
        session.name = name;
        session.endedAt = null;
        return this.repository.save(session);
    }

    async update(id: number, userId: number, fields: { name?: string }): Promise<Session | null> {
        const session = await this.findByIdForUser(id, userId);
        if (!session) {
            return null;
        }
        if (fields.name !== undefined) {
            session.name = fields.name;
        }
        return this.repository.save(session);
    }

    async delete(id: number, userId: number): Promise<boolean> {
        const result = await this.repository.delete({ id, userId });
        return (result.affected ?? 0) > 0;
    }

    /**
     * Atomically end a session. The `endedAt IS NULL` guard in the `WHERE`
     * makes this idempotent: a second call returns `'already_ended'` rather
     * than re-stamping `ended_at`. The controller maps the three outcomes to
     * 200 / 409 / 404 respectively (ADR 0005).
     */
    async markEnded(id: number, userId: number): Promise<MarkEndedResult> {
        const now = new Date();
        const result = await this.repository.update(
            { id, userId, endedAt: IsNull() },
            // `repository.update()` bypasses entity lifecycle hooks, so the
            // `@UpdateDateColumn` won't fire — bump `updatedAt` explicitly so
            // clients that sort by it see the change.
            { endedAt: now, updatedAt: now },
        );

        if (result.affected && result.affected > 0) {
            // Re-fetch so the caller gets the row in its mapped (camelCase)
            // form. The row must still exist here — we just updated it under
            // the same owner-scoped filter.
            const session = await this.findByIdForUser(id, userId);
            if (session) {
                return { status: 'ended', session };
            }
        }

        // Affected = 0 — either the row doesn't exist for this user, or it's
        // already ended. Look it up to decide which.
        const existing = await this.findByIdForUser(id, userId);
        if (!existing) {
            return { status: 'not_found' };
        }
        return { status: 'already_ended', session: existing };
    }
}

export type MarkEndedResult =
    | { status: 'ended'; session: Session }
    | { status: 'already_ended'; session: Session }
    | { status: 'not_found' };

export interface ActiveSessionWithFixtures {
    sessionId: number;
    userId: number;
    fixtureIds: number[];
}

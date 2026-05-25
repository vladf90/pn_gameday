import { Logger } from "../Logger";
import { Context } from "../Logger/Context";
import { SessionRepository, SessionStatusFilter } from "../database/repositories/SessionRepository";
import { SessionFixtureRepository } from "../database/repositories/SessionFixtureRepository";
import { UserAuth } from "../router/UserAuthRouter";
import { ServiceError } from "../utils/ServiceError";
import * as HttpStatusCodes from "http-status-codes";
import { ObjectValidator } from "../validator/ObjectValidator";
import { StringValidator } from "../validator/StringValidator";
import { NumberValidator } from "../validator/NumberValidator";
import { LiveSnapshotStore, LiveFixture } from "../sportmonks";
import { Session } from "../database/entities/Session";

export class SessionController {
    private readonly logger = new Logger("SessionController");

    // `liveSnapshotStore` is optional: when `SPORTMONKS_ENABLED=false`,
    // Bootstrap never constructs it, but the route stays mounted so callers
    // get a stable contract — the response just reports every session fixture
    // as missing.
    //
    // `publicOverlayBaseUrl` is the public URL the frontend serves from
    // (e.g. `http://localhost:5173`). When unset, responses omit `overlayUrl`
    // rather than emit a malformed link — clients can fall back to computing
    // one from `window.location.origin`.
    constructor(
        private readonly sessionRepository: SessionRepository,
        private readonly sessionFixtureRepository: SessionFixtureRepository,
        private readonly liveSnapshotStore: LiveSnapshotStore | undefined,
        private readonly publicOverlayBaseUrl: string | undefined,
    ) {}

    getAll = async (_ctx: Context, auth: UserAuth, request: ListSessionsRequest): Promise<SessionSummary[]> => {
        const status = this.parseStatus(request.status);
        const sessions = await this.sessionRepository.findByUserAndStatus(auth.id, status);
        return sessions.map(s => this.toSessionSummary(s));
    };

    get = async (_ctx: Context, auth: UserAuth, request: GetSessionRequest): Promise<SessionDetail> => {
        const session = await this.sessionRepository.findByIdForUser(request.id, auth.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        const fixtures = await this.sessionFixtureRepository.findBySession(session.id);
        return {
            ...this.toSessionSummary(session),
            fixtureIds: fixtures.map(f => f.sportmonksFixtureId),
        };
    };

    /**
     * Returns the in-memory live snapshot subset for a session.
     *
     * IMPORTANT: this handler MUST NOT make any outbound SportMonks call. The
     * snapshot is populated asynchronously by `FixturePoller` (#7); this read
     * path only joins `session_fixture` → `LiveSnapshotStore`. Fixtures the
     * poller has not yet fetched are surfaced in `missingFixtureIds` rather
     * than triggering a synchronous fetch.
     */
    getLive = async (_ctx: Context, auth: UserAuth, request: GetLiveSessionRequest): Promise<GetLiveSessionResponse> => {
        const session = await this.sessionRepository.findByIdForUser(request.id, auth.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        const fixtureIds = await this.sessionFixtureRepository.findSportmonksFixtureIdsBySessionId(session.id);
        // When SportMonks is disabled, the snapshot store is `undefined`; treat
        // every fixture as missing rather than failing the request.
        const fixtures: LiveFixture[] = this.liveSnapshotStore
            ? this.liveSnapshotStore.getMany(fixtureIds)
            : [];
        const presentIds = new Set(fixtures.map(f => f.id));
        const missingFixtureIds = fixtureIds.filter(id => !presentIds.has(id));
        return {
            sessionId: session.id,
            fixtures,
            missingFixtureIds,
        };
    };

    create = async (_ctx: Context, auth: UserAuth, request: CreateSessionRequest): Promise<SessionSummary> => {
        const session = await this.sessionRepository.create(auth.id, request.name);
        return this.toSessionSummary(session);
    };

    update = async (_ctx: Context, auth: UserAuth, request: UpdateSessionRequest): Promise<SessionSummary> => {
        const updated = await this.sessionRepository.update(request.id, auth.id, { name: request.name });
        if (!updated) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return this.toSessionSummary(updated);
    };

    delete = async (_ctx: Context, auth: UserAuth, request: DeleteSessionRequest): Promise<{ id: number }> => {
        const ok = await this.sessionRepository.delete(request.id, auth.id);
        if (!ok) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return { id: request.id };
    };

    /**
     * Manual force-end. Per ADR 0005, the primary lifecycle mechanism is the
     * auto-closer (issue #60); this endpoint lets a host end a session
     * immediately (e.g. cancelled stream). Idempotent at the SQL layer — a
     * second call observes `ended_at` already set and returns 409.
     */
    end = async (_ctx: Context, auth: UserAuth, request: EndSessionRequest): Promise<SessionSummary> => {
        const result = await this.sessionRepository.markEnded(request.id, auth.id);
        if (result.status === 'not_found') {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        if (result.status === 'already_ended') {
            throw ServiceError.build("Session already ended", HttpStatusCodes.CONFLICT);
        }
        return this.toSessionSummary(result.session);
    };

    /**
     * Unauthenticated read for the OBS Browser Source overlay (ADR 0005 §4).
     * Mounted on `NoAuthRouter` because OBS sends no Authorization header —
     * the URL is the capability. Returns the same live-snapshot subset as
     * `getLive`, plus the session's name and `endedAt` so the overlay can
     * render a "session ended" state without needing a second round-trip.
     *
     * Looked up via `findByIdPublic` — no user filter.
     */
    publicOverlay = async (
        _ctx: Context,
        _auth: void,
        request: PublicOverlayRequest,
    ): Promise<PublicOverlayResponse> => {
        const session = await this.sessionRepository.findByIdPublic(request.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        const fixtureIds = await this.sessionFixtureRepository.findSportmonksFixtureIdsBySessionId(session.id);
        const fixtures: LiveFixture[] = this.liveSnapshotStore
            ? this.liveSnapshotStore.getMany(fixtureIds)
            : [];
        const presentIds = new Set(fixtures.map(f => f.id));
        const missingFixtureIds = fixtureIds.filter(id => !presentIds.has(id));
        return {
            sessionId: session.id,
            name: session.name,
            endedAt: session.endedAt,
            fixtures,
            missingFixtureIds,
        };
    };

    attachFixture = async (
        _ctx: Context,
        auth: UserAuth,
        request: AttachFixtureRequest,
    ): Promise<AttachFixtureResponse> => {
        const session = await this.sessionRepository.findByIdForUser(request.id, auth.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }

        const existing = await this.sessionFixtureRepository.findOne(request.id, request.sportmonksFixtureId);
        if (existing) {
            throw ServiceError.build("Fixture already attached to session", HttpStatusCodes.CONFLICT);
        }

        const attached = await this.sessionFixtureRepository.attach(request.id, request.sportmonksFixtureId);
        return {
            sessionId: attached.sessionId,
            sportmonksFixtureId: attached.sportmonksFixtureId,
        };
    };

    detachFixture = async (
        _ctx: Context,
        auth: UserAuth,
        request: DetachFixtureRequest,
    ): Promise<{ sessionId: number; sportmonksFixtureId: number }> => {
        // Verify ownership before touching the join table — otherwise a request
        // for someone else's session would 404 on `detach()` only because the
        // (session_id, fixture_id) tuple doesn't match, which is a confusing
        // error surface.
        const session = await this.sessionRepository.findByIdForUser(request.id, auth.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        const ok = await this.sessionFixtureRepository.detach(request.id, request.fixtureId);
        if (!ok) {
            throw ServiceError.build("Fixture not attached to session", HttpStatusCodes.NOT_FOUND);
        }
        return { sessionId: request.id, sportmonksFixtureId: request.fixtureId };
    };

    private parseStatus(raw: unknown): SessionStatusFilter {
        if (raw === 'active' || raw === 'ended' || raw === 'all') {
            return raw;
        }
        if (raw === undefined || raw === '' || raw === null) {
            return 'active';
        }
        throw ServiceError.build(
            `Invalid status filter "${String(raw)}" — expected one of: active, ended, all`,
            HttpStatusCodes.BAD_REQUEST,
        );
    }

    private toSessionSummary(session: Session): SessionSummary {
        const summary: SessionSummary = {
            id: session.id,
            name: session.name,
            endedAt: session.endedAt,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        };
        if (this.publicOverlayBaseUrl) {
            // Trim trailing slash so concatenation stays clean regardless of
            // operator habits (`http://host` vs `http://host/`).
            const base = this.publicOverlayBaseUrl.replace(/\/+$/, '');
            summary.overlayUrl = `${base}/overlay/${session.id}`;
        }
        return summary;
    }
}

export interface SessionSummary {
    id: number;
    name: string;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    /**
     * Absolute URL to paste into OBS as a Browser Source (ADR 0005). Omitted
     * when `PUBLIC_OVERLAY_BASE_URL` is unset — clients can fall back to
     * computing one from `window.location.origin`.
     */
    overlayUrl?: string;
}

export interface SessionDetail extends SessionSummary {
    fixtureIds: number[];
}

export interface ListSessionsRequest {
    status?: string;
}

export interface GetSessionRequest {
    id: number;
}

export interface GetLiveSessionRequest {
    id: number;
}

export interface GetLiveSessionResponse {
    sessionId: number;
    fixtures: LiveFixture[];
    missingFixtureIds: number[];
}

export interface CreateSessionRequest {
    name: string;
}

export interface UpdateSessionRequest {
    id: number;
    name?: string;
}

export interface DeleteSessionRequest {
    id: number;
}

export interface EndSessionRequest {
    id: number;
}

export interface PublicOverlayRequest {
    id: number;
}

export interface PublicOverlayResponse {
    sessionId: number;
    name: string;
    endedAt: Date | null;
    fixtures: LiveFixture[];
    missingFixtureIds: number[];
}

export interface AttachFixtureRequest {
    id: number;
    sportmonksFixtureId: number;
}

export interface AttachFixtureResponse {
    sessionId: number;
    sportmonksFixtureId: number;
}

export interface DetachFixtureRequest {
    id: number;
    fixtureId: number;
}

export class GetSessionValidator extends ObjectValidator<GetSessionRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}

export class GetLiveSessionValidator extends ObjectValidator<GetLiveSessionRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}

export class CreateSessionValidator extends ObjectValidator<CreateSessionRequest> {
    constructor() {
        super();
        this.add("name", new StringValidator());
    }
}

export class UpdateSessionValidator extends ObjectValidator<UpdateSessionRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
        this.add("name", new StringValidator(true));
    }
}

export class DeleteSessionValidator extends ObjectValidator<DeleteSessionRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}

export class EndSessionValidator extends ObjectValidator<EndSessionRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}

export class PublicOverlayValidator extends ObjectValidator<PublicOverlayRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}

export class AttachFixtureValidator extends ObjectValidator<AttachFixtureRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
        this.add("sportmonksFixtureId", new NumberValidator());
    }
}

export class DetachFixtureValidator extends ObjectValidator<DetachFixtureRequest> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
        this.add("fixtureId", new NumberValidator());
    }
}

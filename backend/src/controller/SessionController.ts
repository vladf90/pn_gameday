import { Logger } from "../Logger";
import { Context } from "../Logger/Context";
import { SessionRepository } from "../database/repositories/SessionRepository";
import { SessionFixtureRepository } from "../database/repositories/SessionFixtureRepository";
import { UserAuth } from "../router/UserAuthRouter";
import { ServiceError } from "../utils/ServiceError";
import * as HttpStatusCodes from "http-status-codes";
import { ObjectValidator } from "../validator/ObjectValidator";
import { StringValidator } from "../validator/StringValidator";
import { NumberValidator } from "../validator/NumberValidator";
import { LiveSnapshotStore, LiveFixture } from "../sportmonks";

export class SessionController {
    private readonly logger = new Logger("SessionController");

    // `liveSnapshotStore` is optional: when `SPORTMONKS_ENABLED=false`,
    // Bootstrap never constructs it, but the route stays mounted so callers
    // get a stable contract — the response just reports every session fixture
    // as missing.
    constructor(
        private readonly sessionRepository: SessionRepository,
        private readonly sessionFixtureRepository: SessionFixtureRepository,
        private readonly liveSnapshotStore: LiveSnapshotStore | undefined,
    ) {}

    getAll = async (_ctx: Context, _auth: UserAuth): Promise<SessionSummary[]> => {
        const sessions = await this.sessionRepository.findAll();
        return sessions.map(toSessionSummary);
    };

    get = async (_ctx: Context, _auth: UserAuth, request: GetSessionRequest): Promise<SessionDetail> => {
        const session = await this.sessionRepository.findById(request.id);
        if (!session) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        const fixtures = await this.sessionFixtureRepository.findBySession(session.id);
        return {
            ...toSessionSummary(session),
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
    getLive = async (_ctx: Context, _auth: UserAuth, request: GetLiveSessionRequest): Promise<GetLiveSessionResponse> => {
        const session = await this.sessionRepository.findById(request.id);
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

    create = async (_ctx: Context, _auth: UserAuth, request: CreateSessionRequest): Promise<SessionSummary> => {
        const session = await this.sessionRepository.create(request.name);
        return toSessionSummary(session);
    };

    update = async (_ctx: Context, _auth: UserAuth, request: UpdateSessionRequest): Promise<SessionSummary> => {
        const updated = await this.sessionRepository.update(request.id, { name: request.name });
        if (!updated) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return toSessionSummary(updated);
    };

    delete = async (_ctx: Context, _auth: UserAuth, request: DeleteSessionRequest): Promise<{ id: number }> => {
        const ok = await this.sessionRepository.delete(request.id);
        if (!ok) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return { id: request.id };
    };

    attachFixture = async (
        _ctx: Context,
        _auth: UserAuth,
        request: AttachFixtureRequest,
    ): Promise<AttachFixtureResponse> => {
        const session = await this.sessionRepository.findById(request.id);
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
        _auth: UserAuth,
        request: DetachFixtureRequest,
    ): Promise<{ sessionId: number; sportmonksFixtureId: number }> => {
        const ok = await this.sessionFixtureRepository.detach(request.id, request.fixtureId);
        if (!ok) {
            throw ServiceError.build("Fixture not attached to session", HttpStatusCodes.NOT_FOUND);
        }
        return { sessionId: request.id, sportmonksFixtureId: request.fixtureId };
    };
}

function toSessionSummary(session: {
    id: number;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}): SessionSummary {
    return {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    };
}

export interface SessionSummary {
    id: number;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface SessionDetail extends SessionSummary {
    fixtureIds: number[];
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

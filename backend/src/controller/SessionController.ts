import { Request, Response } from "express";
import { Logger } from "../Logger";
import { SessionRepository, SessionStatusFilter } from "../database/repositories/SessionRepository";
import { SessionFixtureRepository } from "../database/repositories/SessionFixtureRepository";
import { UserAuth } from "../router/UserAuthRouter";
import { ServiceError } from "../utils/ServiceError";
import * as HttpStatusCodes from "http-status-codes";
import { ObjectValidator } from "../validator/ObjectValidator";
import { StringValidator } from "../validator/StringValidator";
import { NumberValidator } from "../validator/NumberValidator";
import { LiveSnapshotStore, LiveFixture } from "../sportmonks";
import { OverlayEventBus, OverlayPayload } from "../sportmonks/OverlayEventBus";
import { Session } from "../database/entities/Session";

/** SSE keep-alive cadence (ADR 0006). Sent as a `:\n\n` comment frame so
 *  intermediary proxies don't terminate idle connections. Slightly under
 *  30s because some hosted proxies idle-timeout at the 30s mark. */
const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

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
    //
    // `overlayEventBus` is the per-session subscriber registry used by the
    // SSE stream handler (ADR 0006). Always constructed in Bootstrap so the
    // route can mount regardless of SportMonks being enabled — pushes just
    // never happen when there's no poller wired up.
    constructor(
        private readonly sessionRepository: SessionRepository,
        private readonly sessionFixtureRepository: SessionFixtureRepository,
        private readonly liveSnapshotStore: LiveSnapshotStore | undefined,
        private readonly publicOverlayBaseUrl: string | undefined,
        private readonly overlayEventBus: OverlayEventBus,
    ) {}

    getAll = async (auth: UserAuth, request: ListSessionsRequest): Promise<SessionSummary[]> => {
        const status = this.parseStatus(request.status);
        const sessions = await this.sessionRepository.findByUserAndStatus(auth.id, status);
        return sessions.map(s => this.toSessionSummary(s));
    };

    get = async (auth: UserAuth, request: GetSessionRequest): Promise<SessionDetail> => {
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
    getLive = async (auth: UserAuth, request: GetLiveSessionRequest): Promise<GetLiveSessionResponse> => {
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

    create = async (auth: UserAuth, request: CreateSessionRequest): Promise<SessionSummary> => {
        const session = await this.sessionRepository.create(auth.id, request.name);
        return this.toSessionSummary(session);
    };

    update = async (auth: UserAuth, request: UpdateSessionRequest): Promise<SessionSummary> => {
        const updated = await this.sessionRepository.update(request.id, auth.id, { name: request.name });
        if (!updated) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return this.toSessionSummary(updated);
    };

    delete = async (auth: UserAuth, request: DeleteSessionRequest): Promise<{ id: number }> => {
        const ok = await this.sessionRepository.delete(request.id, auth.id);
        if (!ok) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return { id: request.id };
    };

    /**
     * Rotate the overlay token (ADR 0008). Overwrites `session.overlay_token`
     * in place; any URL holding the previous token immediately 404s. Owner-
     * scoped — non-owner gets 404 (don't leak existence). Returns the updated
     * `SessionSummary` so the frontend can swap the displayed overlay URL in
     * place without a follow-up GET.
     */
    rotateOverlayToken = async (auth: UserAuth, request: RotateOverlayTokenRequest): Promise<SessionSummary> => {
        const rotated = await this.sessionRepository.rotateOverlayToken(request.id, auth.id);
        if (!rotated) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return this.toSessionSummary(rotated);
    };

    /**
     * Manual force-end. Per ADR 0005, the primary lifecycle mechanism is the
     * auto-closer (issue #60); this endpoint lets a host end a session
     * immediately (e.g. cancelled stream). Idempotent at the SQL layer — a
     * second call observes `ended_at` already set and returns 409.
     */
    end = async (auth: UserAuth, request: EndSessionRequest): Promise<SessionSummary> => {
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
     * Token validation (ADR 0008): missing or mismatched `token` → 404
     * (same surface as "session id doesn't exist"), to avoid leaking which
     * ids are real.
     */
    publicOverlay = async (
        _auth: void,
        request: PublicOverlayRequest,
    ): Promise<PublicOverlayResponse> => {
        const payload = await this.buildOverlayPayload(request.id, request.token);
        if (!payload) {
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }
        return payload;
    };

    /**
     * Server-Sent Events stream for the public OBS overlay (ADR 0006).
     *
     * Lifecycle:
     *   1. 404 if the session id is unknown — same lookup as `publicOverlay`.
     *   2. Send one immediate snapshot frame so the overlay can render
     *      without waiting up to a full poll interval (~5s) for the first
     *      push.
     *   3. If the session is already ended, send the snapshot (with
     *      `endedAt` set) and close the stream. The overlay keeps the
     *      final frame on screen — per ADR 0006 §4 we do not push an
     *      "ended" message of our own.
     *   4. Otherwise subscribe to `overlayEventBus` for this session id.
     *      Frames are pushed by the `FixturePoller` `onTickFinished` hook
     *      wired in `Bootstrap`, one per ~5s tick.
     *   5. Run a 25s heartbeat (`:\n\n` SSE comment) so intermediary
     *      proxies don't terminate idle connections during long stretches
     *      between score changes.
     *   6. On `req.close` (client navigated away / OBS reload / process
     *      tear-down) unsubscribe and clear the heartbeat.
     */
    streamPublicOverlay = async (
        _auth: void,
        req: Request,
        res: Response,
    ): Promise<void> => {
        // Path is `/public/sessions/:id/overlay/stream`, so `id` is in params.
        // `BaseRouter.sse` doesn't run the `ObjectValidator` pipeline (it's
        // bypassing the normal request-parsing path), so we validate inline.
        const rawId = req.params.id;
        const sessionId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(sessionId) || sessionId <= 0) {
            // Headers haven't been flushed yet when we throw here — the
            // BaseRouter wrapper catches and renders a normal 4xx JSON.
            throw ServiceError.build("Invalid session id", HttpStatusCodes.BAD_REQUEST);
        }

        // Token validation (ADR 0008). `req.query.token` is `string | string[]
        // | ParsedQs | undefined`; we only accept a plain string. Missing /
        // wrong-shape / mismatched token → 404 (see `buildOverlayPayload`).
        const rawToken = req.query.token;
        const token = typeof rawToken === "string" ? rawToken : undefined;

        const payload = await this.buildOverlayPayload(sessionId, token);
        if (!payload) {
            // Same — pre-flush, so this surfaces as a normal 404.
            throw ServiceError.build("Session not found", HttpStatusCodes.NOT_FOUND);
        }

        // Headers were already set + flushed by `BaseRouter.sse` before this
        // handler ran, so any write here is a frame the client will see.
        //
        // The writer also drives the terminal-frame protocol from ADR 0006 §4:
        // when a payload carries a non-null `endedAt`, we write the final frame
        // AND close the response, then return `false` so the bus evicts us.
        // This collapses "broadcast last frame" and "tear down stream" into a
        // single event the broadcaster doesn't have to special-case.
        const writeFrame = (p: OverlayPayload): boolean => {
            if (res.writableEnded || res.destroyed) {
                return false;
            }
            try {
                res.write(`data: ${JSON.stringify(p)}\n\n`);
                if (p.endedAt !== null) {
                    res.end();
                    return false;
                }
                return true;
            } catch {
                return false;
            }
        };

        const initial: OverlayPayload = { ...payload, serverTime: Date.now() };

        // If the session is already ended, deliver the final frame and
        // close. The client renders whatever scores were on the snapshot —
        // there is no follow-up `endedAt` overlay text (ADR 0006 §4).
        if (initial.endedAt !== null) {
            writeFrame(initial);
            res.end();
            return;
        }

        // Send the initial frame before subscribing so a poll-tick race
        // can't slip an out-of-order frame ahead of it.
        writeFrame(initial);

        const unsubscribe = this.overlayEventBus.subscribe(sessionId, writeFrame);

        // SSE comment heartbeat. Anything starting with `:` is ignored by
        // `EventSource` and serves only to keep the TCP/HTTP path warm
        // through proxies that idle-timeout long-lived connections.
        const heartbeat = setInterval(() => {
            if (res.writableEnded || res.destroyed) {
                clearInterval(heartbeat);
                return;
            }
            try {
                res.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
                clearInterval(heartbeat);
            }
        }, SSE_HEARTBEAT_INTERVAL_MS);

        const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
        };

        req.on("close", cleanup);
        req.on("error", cleanup);
    };

    /**
     * Token-gated payload builder for `publicOverlay` (HTTP) and the initial
     * frame in `streamPublicOverlay` (SSE). Returns `null` when the session
     * id is unknown, the token is missing, or the token doesn't match —
     * callers translate all three into a 404 (ADR 0008: don't leak which
     * session ids exist).
     */
    private async buildOverlayPayload(sessionId: number, token: string | undefined): Promise<PublicOverlayResponse | null> {
        if (!token) {
            return null;
        }
        const session = await this.sessionRepository.findByIdAndToken(sessionId, token);
        if (!session) {
            return null;
        }
        return this.assembleOverlayPayload(session.id, session.name, session.endedAt);
    }

    /**
     * Trusted variant for the broadcast loop (ADR 0008). The subscriber was
     * already authorised at `subscribe` time, so this path skips token
     * re-validation on every tick. Falls back to `findByIdPublic` and
     * returns `null` only when the session id no longer exists (e.g. it was
     * deleted while the overlay was open) — the broadcast loop surfaces
     * that as a synthetic "ended" frame.
     */
    private async buildOverlayPayloadTrusted(sessionId: number): Promise<PublicOverlayResponse | null> {
        const session = await this.sessionRepository.findByIdPublic(sessionId);
        if (!session) {
            return null;
        }
        return this.assembleOverlayPayload(session.id, session.name, session.endedAt);
    }

    /**
     * Shared snapshot-assembly path. Lives outside the two `buildOverlay*`
     * variants so both share the exact same fixture-join + missing-id logic.
     */
    private async assembleOverlayPayload(sessionId: number, name: string, endedAt: Date | null): Promise<PublicOverlayResponse> {
        const fixtureIds = await this.sessionFixtureRepository.findSportmonksFixtureIdsBySessionId(sessionId);
        const fixtures: LiveFixture[] = this.liveSnapshotStore
            ? this.liveSnapshotStore.getMany(fixtureIds)
            : [];
        const presentIds = new Set(fixtures.map(f => f.id));
        const missingFixtureIds = fixtureIds.filter(id => !presentIds.has(id));
        return {
            sessionId,
            name,
            endedAt,
            fixtures,
            missingFixtureIds,
        };
    }

    /**
     * Called by `Bootstrap`'s `FixturePoller.onTickFinished` hook (ADR 0006).
     * Walks the bus's currently-subscribed session ids and broadcasts one
     * fresh payload per session. The DB hits are bounded by viewer activity,
     * not by total sessions.
     *
     * Sessions that have flipped to ended (auto-closed or force-ended) push
     * one final frame with `endedAt` set — the writer recognises that and
     * closes the underlying response after the write (see `writeFrame`).
     * After that the subscribers self-evict and no further broadcasts hit
     * those clients.
     */
    broadcastOverlayUpdates = async (): Promise<void> => {
        const sessionIds = this.overlayEventBus.subscribedSessionIds();
        if (sessionIds.length === 0) {
            return;
        }
        const serverTime = Date.now();
        for (const sessionId of sessionIds) {
            // ADR 0008: skip token validation here — the subscription was
            // authorised when `subscribe` was called, and tokens don't
            // expire (rotation only affects future URL openings).
            const payload = await this.buildOverlayPayloadTrusted(sessionId);
            if (!payload) {
                // Session was deleted while overlay was open. Force-close
                // by broadcasting a synthetic "ended" payload so writers
                // tear down their streams instead of waiting for the next
                // tick (which will hit the same null lookup).
                this.overlayEventBus.broadcast(sessionId, {
                    sessionId,
                    name: "",
                    endedAt: new Date(),
                    fixtures: [],
                    missingFixtureIds: [],
                    serverTime,
                });
                continue;
            }
            this.overlayEventBus.broadcast(sessionId, { ...payload, serverTime });
        }
    };

    attachFixture = async (
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
        // Token is the capability (ADR 0008). The encode is paranoia — hex
        // tokens are URL-safe by construction, but `encodeURIComponent`
        // keeps the contract explicit so a future token format change
        // doesn't silently emit a broken URL.
        const token = encodeURIComponent(session.overlayToken);
        // When the base URL is unset (dev without env override), emit a
        // root-relative URL so the frontend can resolve it against its own
        // origin. Building it here keeps the token bundled — ADR 0008 wants
        // a single source of overlay-URL truth.
        const base = this.publicOverlayBaseUrl?.replace(/\/+$/, '') ?? '';
        return {
            id: session.id,
            name: session.name,
            endedAt: session.endedAt,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            overlayUrl: `${base}/overlay/${session.id}?token=${token}`,
        };
    }
}

export interface SessionSummary {
    id: number;
    name: string;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    /**
     * Overlay URL to paste into OBS as a Browser Source (ADR 0005/0008).
     * Absolute when `PUBLIC_OVERLAY_BASE_URL` is set, otherwise root-relative
     * (`/overlay/:id?token=…`) — the frontend resolves relatives against
     * `window.location.origin`.
     */
    overlayUrl: string;
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
    /**
     * Per-session capability token (ADR 0008). Optional in the request shape
     * because `parseQuery` returns `undefined` when the query param is
     * missing; the controller treats `undefined`/empty as a 404.
     */
    token?: string;
}

export interface RotateOverlayTokenRequest {
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
        // `token` is optional at the validator layer so a missing token
        // surfaces as the controller's 404 (ADR 0008: don't leak existence)
        // rather than a 400 "validation error" that would say the query
        // shape is wrong.
        this.add("token", new StringValidator(true));
    }
}

export class RotateOverlayTokenValidator extends ObjectValidator<RotateOverlayTokenRequest> {
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

import {RequestClient} from "./RequestClient";
import {FixtureModel} from "../common/fixtures";

export type SessionStatusFilter = 'active' | 'ended' | 'all';

export interface SessionSummary {
    id: number;
    name: string;
    endedAt: string | null;
    createdAt: string;
    updatedAt: string;
    /**
     * Overlay URL (ADR 0005/0008). Absolute when the backend has
     * `PUBLIC_OVERLAY_BASE_URL` set, otherwise root-relative — callers must
     * resolve it against `window.location.origin` before sharing.
     */
    overlayUrl: string;
}

export interface SessionDetail extends SessionSummary {
    fixtureIds: number[];
}

export class SessionRequestClient extends RequestClient {
    async list(status: SessionStatusFilter = 'active'): Promise<SessionSummary[]> {
        return await this.get<{status: SessionStatusFilter}, SessionSummary[]>(
            "/sessions",
            {status},
        );
    }

    async getOne(id: number): Promise<SessionDetail> {
        return await this.get<void, SessionDetail>(`/sessions/${id}`);
    }

    async create(name: string): Promise<SessionSummary> {
        return await this.post<{name: string}, SessionSummary, void>(
            "/sessions",
            {name},
        );
    }

    async rename(id: number, name: string): Promise<SessionSummary> {
        return await this.patch<{name: string}, SessionSummary, void>(
            `/sessions/${id}`,
            {name},
        );
    }

    async remove(id: number): Promise<{id: number}> {
        return await this.delete<{id: number}, void>(`/sessions/${id}`);
    }

    async end(id: number): Promise<SessionSummary> {
        return await this.post<void, SessionSummary, void>(
            `/sessions/${id}/end`,
            undefined,
        );
    }

    /**
     * Rotate the per-session overlay capability token (ADR 0008). Returns the
     * refreshed `SessionSummary` with the new `overlayUrl`. Any OBS instance
     * still using the previous URL will 404 on its next reload.
     */
    async rotateOverlayToken(id: number): Promise<SessionSummary> {
        return await this.post<void, SessionSummary, void>(
            `/sessions/${id}/overlay/token/rotate`,
            undefined,
        );
    }

    async attachFixture(sessionId: number, sportmonksFixtureId: number): Promise<AttachFixtureResponse> {
        return await this.post<{sportmonksFixtureId: number}, AttachFixtureResponse, void>(
            `/sessions/${sessionId}/fixtures`,
            {sportmonksFixtureId},
        );
    }

    async detachFixture(sessionId: number, sportmonksFixtureId: number): Promise<{sessionId: number; sportmonksFixtureId: number}> {
        return await this.delete<{sessionId: number; sportmonksFixtureId: number}, void>(
            `/sessions/${sessionId}/fixtures/${sportmonksFixtureId}`,
        );
    }

    /**
     * Authenticated live snapshot for this session — same data the public
     * overlay endpoint serves. Useful inside the detail page so the host can
     * preview what the overlay will show before publishing the URL.
     */
    async getLive(id: number): Promise<GetLiveSessionResponse> {
        return await this.get<void, GetLiveSessionResponse>(`/sessions/${id}/live`);
    }
}

export interface AttachFixtureResponse {
    sessionId: number;
    sportmonksFixtureId: number;
}

export interface GetLiveSessionResponse {
    sessionId: number;
    fixtures: FixtureModel[];
    missingFixtureIds: number[];
}

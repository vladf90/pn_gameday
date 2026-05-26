import axios from "axios";
import {FixtureModel} from "../common/fixtures";

/**
 * Public, unauthenticated client for the OBS overlay endpoint (ADR 0005 §4).
 *
 * Deliberately does NOT extend `RequestClient` — the overlay must never send
 * an `Authorization` header. OBS Browser Source has no localStorage to
 * inherit from anyway, but a developer hitting the overlay URL from a logged-
 * in browser tab should still get the public response. The URL is the
 * capability.
 */
export interface PublicOverlayResponse {
    sessionId: number;
    name: string;
    endedAt: string | null;
    fixtures: FixtureModel[];
    missingFixtureIds: number[];
}

/**
 * SSE frame payload (ADR 0006). Same shape as the JSON `fetch` response
 * plus a `serverTime` field — epoch ms at frame emission — used by the
 * frontend match timer to anchor smooth local extrapolation against the
 * backend's clock rather than the viewer's (skew-free).
 */
export interface PublicOverlayStreamMessage extends PublicOverlayResponse {
    serverTime: number;
}

export type OverlayStreamHandlers = {
    /** Called for every frame the server pushes (initial + per-tick). */
    onMessage: (payload: PublicOverlayStreamMessage) => void;
    /**
     * Called once when the server hangs up cleanly — either because the
     * session was already ended at connect time, or because it ended
     * mid-stream and the server closed the connection after the final
     * frame. The caller MUST stop expecting further updates after this.
     */
    onClose: () => void;
};

export class OverlayRequestClient {
    /**
     * One-shot HTTP fetch — used as a non-streaming fallback and by ad-hoc
     * tooling (e.g. `curl`). Production overlay rendering uses
     * `subscribeStream` instead (ADR 0006).
     *
     * `token` is the per-session capability token from ADR 0008.
     */
    async fetch(sessionId: number, token: string): Promise<PublicOverlayResponse> {
        const response = await axios.request({
            method: "get",
            baseURL: "/api",
            url: `/public/sessions/${sessionId}/overlay`,
            params: { token },
        });
        return response.data.data;
    }

    /**
     * Open a Server-Sent Events subscription for the given session id.
     * Returns the underlying `EventSource` so the caller can `.close()` it
     * on unmount.
     *
     * `token` is the per-session capability token from ADR 0008 — the
     * server 404s the SSE handshake (pre-flush) if it's missing or wrong.
     *
     * Frame parsing tolerates malformed bodies (logs + skip) so a single
     * bad frame can't take the overlay offline — `EventSource` will keep
     * delivering subsequent frames.
     *
     * `onerror` distinguishes two cases:
     *   - `readyState === CLOSED` — server hung up, we treat that as a
     *     clean end-of-session and invoke `onClose` once.
     *   - other readyStates — transient network blip; `EventSource`
     *     auto-reconnects, so we deliberately stay silent here.
     */
    subscribeStream(sessionId: number, token: string, handlers: OverlayStreamHandlers): EventSource {
        const url = `/api/public/sessions/${sessionId}/overlay/stream?token=${encodeURIComponent(token)}`;
        const source = new EventSource(url);

        source.onmessage = (event: MessageEvent) => {
            let payload: PublicOverlayStreamMessage;
            try {
                payload = JSON.parse(event.data) as PublicOverlayStreamMessage;
            } catch (err) {
                console.warn("OverlayRequestClient: discarded malformed SSE frame", err);
                return;
            }
            handlers.onMessage(payload);
        };

        let closeReported = false;
        source.onerror = () => {
            if (source.readyState === EventSource.CLOSED && !closeReported) {
                closeReported = true;
                handlers.onClose();
            }
            // Other states: `CONNECTING` (reconnect in progress) — let
            // EventSource keep retrying without surfacing transient errors
            // to the overlay UI.
        };

        return source;
    }
}

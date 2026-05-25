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

export class OverlayRequestClient {
    async fetch(sessionId: number): Promise<PublicOverlayResponse> {
        const response = await axios.request({
            method: "get",
            baseURL: "/api",
            url: `/public/sessions/${sessionId}/overlay`,
        });
        return response.data.data;
    }
}

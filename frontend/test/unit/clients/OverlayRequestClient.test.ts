/**
 * Unit tests for OverlayRequestClient.
 *
 * - `fetch` uses axios.request; mocked at module boundary.
 * - `subscribeStream` uses the browser EventSource API; we provide a minimal
 *   stub so we can drive onmessage / onerror without a real server.
 * - No real HTTP or SSE connections are opened.
 */
import {beforeEach, describe, expect, it, vi} from "vitest";

const {axiosRequestMock} = vi.hoisted(() => ({axiosRequestMock: vi.fn()}));

vi.mock("axios", () => ({
    default: {request: axiosRequestMock, post: vi.fn()},
}));

import {OverlayRequestClient} from "../../../src/clients/OverlayRequestClient";
import type {OverlayStreamHandlers, PublicOverlayStreamMessage} from "../../../src/clients/OverlayRequestClient";

function makeResponse(data: unknown) {
    return {data: {data}};
}

// ---------------------------------------------------------------------------
// Minimal EventSource stub
// ---------------------------------------------------------------------------

interface EventSourceStub {
    url: string;
    readyState: number;
    onmessage: ((e: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
    // Test helpers to simulate server events
    _emit: (data: unknown) => void;
    _close: () => void;
}

function createEventSourceStub(url: string): EventSourceStub {
    const stub: EventSourceStub = {
        url,
        readyState: 1, // OPEN
        onmessage: null,
        onerror: null,
        close: vi.fn(),
        _emit(data) {
            stub.onmessage?.({data: JSON.stringify(data)} as MessageEvent);
        },
        _close() {
            stub.readyState = 2; // CLOSED
            stub.onerror?.();
        },
    };
    return stub;
}

let lastStub: EventSourceStub | null = null;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OverlayRequestClient", () => {
    let client: OverlayRequestClient;

    beforeEach(() => {
        axiosRequestMock.mockReset();
        lastStub = null;
        client = new OverlayRequestClient();

        // Stub window.EventSource so subscribeStream gets our controlled stub.
        // We must set EventSource.CLOSED = 2 because the source code checks
        // `source.readyState === EventSource.CLOSED` as a static property.
        const EventSourceMock = vi.fn().mockImplementation((url: string) => {
            lastStub = createEventSourceStub(url);
            return lastStub;
        }) as unknown as typeof EventSource;
        (EventSourceMock as unknown as {CLOSED: number}).CLOSED = 2;
        (EventSourceMock as unknown as {OPEN: number}).OPEN = 1;
        (EventSourceMock as unknown as {CONNECTING: number}).CONNECTING = 0;
        vi.stubGlobal("EventSource", EventSourceMock);
    });

    // -----------------------------------------------------------------------
    // fetch
    // -----------------------------------------------------------------------

    describe("fetch", () => {
        it("sends GET /public/sessions/:id/overlay with token param", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({sessionId: 5, name: "Test", endedAt: null, fixtures: [], missingFixtureIds: []}),
            );
            await client.fetch(5, "cap-token");
            expect(axiosRequestMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "get",
                    baseURL: "/api",
                    url: "/public/sessions/5/overlay",
                    params: {token: "cap-token"},
                }),
            );
        });

        it("does NOT include an Authorization header (unauthenticated endpoint)", async () => {
            axiosRequestMock.mockResolvedValueOnce(
                makeResponse({sessionId: 5, name: "T", endedAt: null, fixtures: [], missingFixtureIds: []}),
            );
            await client.fetch(5, "cap-token");
            const config = axiosRequestMock.mock.calls[0][0];
            // OverlayRequestClient does not extend RequestClient — no auth header
            expect(config.headers).toBeUndefined();
        });

        it("returns the response data", async () => {
            const payload = {sessionId: 5, name: "T", endedAt: null, fixtures: [{id: 1}], missingFixtureIds: []};
            axiosRequestMock.mockResolvedValueOnce(makeResponse(payload));
            const result = await client.fetch(5, "cap-token");
            expect(result).toEqual(payload);
        });

        it("propagates errors", async () => {
            axiosRequestMock.mockRejectedValueOnce(new Error("404 Not Found"));
            await expect(client.fetch(5, "bad-token")).rejects.toThrow("404 Not Found");
        });
    });

    // -----------------------------------------------------------------------
    // subscribeStream
    // -----------------------------------------------------------------------

    describe("subscribeStream", () => {
        it("opens EventSource with the correct URL including encoded token", () => {
            const handlers: OverlayStreamHandlers = {onMessage: vi.fn(), onClose: vi.fn()};
            client.subscribeStream(5, "my token&special", handlers);
            expect(lastStub?.url).toBe(
                "/api/public/sessions/5/overlay/stream?token=my%20token%26special",
            );
        });

        it("returns the EventSource", () => {
            const handlers: OverlayStreamHandlers = {onMessage: vi.fn(), onClose: vi.fn()};
            const source = client.subscribeStream(5, "tok", handlers);
            expect(source).toBe(lastStub);
        });

        it("calls onMessage handler with parsed payload on each SSE frame", () => {
            const onMessage = vi.fn();
            client.subscribeStream(5, "tok", {onMessage, onClose: vi.fn()});
            const msg: PublicOverlayStreamMessage = {
                sessionId: 5,
                name: "Test",
                endedAt: null,
                fixtures: [],
                missingFixtureIds: [],
                serverTime: 12345,
            };
            lastStub!._emit(msg);
            expect(onMessage).toHaveBeenCalledWith(msg);
        });

        it("discards malformed SSE frames without calling onMessage", () => {
            const onMessage = vi.fn();
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            client.subscribeStream(5, "tok", {onMessage, onClose: vi.fn()});
            // Directly invoke onmessage with bad JSON
            lastStub!.onmessage?.({data: "{bad-json"} as MessageEvent);
            expect(onMessage).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("calls onClose when EventSource readyState becomes CLOSED", () => {
            const onClose = vi.fn();
            client.subscribeStream(5, "tok", {onMessage: vi.fn(), onClose});
            lastStub!._close();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it("calls onClose at most once even if onerror fires multiple times", () => {
            const onClose = vi.fn();
            client.subscribeStream(5, "tok", {onMessage: vi.fn(), onClose});
            // Force CLOSED + fire onerror twice
            lastStub!.readyState = 2;
            lastStub!.onerror?.();
            lastStub!.onerror?.();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it("does NOT call onClose when readyState is not CLOSED (transient error)", () => {
            const onClose = vi.fn();
            client.subscribeStream(5, "tok", {onMessage: vi.fn(), onClose});
            // Simulate a transient error — readyState stays CONNECTING (0)
            lastStub!.readyState = 0;
            lastStub!.onerror?.();
            expect(onClose).not.toHaveBeenCalled();
        });
    });
});

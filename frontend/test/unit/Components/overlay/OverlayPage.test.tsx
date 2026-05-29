/**
 * Component tests for <OverlayPage />.
 *
 * OverlayRequestClient.subscribeStream is mocked at the module boundary.
 * We simulate SSE frames by invoking the onMessage callback directly.
 * No real EventSource connections are opened.
 *
 * The component reads useParams({ sessionId }) and useSearchParams({ token }).
 * We wrap it in a <Routes><Route path=...> so React Router can resolve the
 * params correctly from the initial history entry.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import {Routes, Route} from "react-router-dom";
import {render} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";

const {subscribeStreamMock} = vi.hoisted(() => ({subscribeStreamMock: vi.fn()}));

vi.mock("../../../../src/clients/OverlayRequestClient", () => ({
    OverlayRequestClient: vi.fn().mockImplementation(() => ({
        subscribeStream: subscribeStreamMock,
    })),
}));

import {OverlayPage} from "../../../../src/Components/overlay/OverlayPage";
import type {
    OverlayStreamHandlers,
    PublicOverlayStreamMessage,
} from "../../../../src/clients/OverlayRequestClient";

/** Fake EventSource returned by the mock so `.close()` can be asserted. */
function fakeSource() {
    return {close: vi.fn(), readyState: 1};
}

/**
 * Render OverlayPage with a proper route so useParams resolves `:sessionId`.
 * We use a plain MemoryRouter + Routes because OverlayPage lives outside the
 * Refine shell in production and doesn't need auth/data providers.
 */
function renderOverlay(sessionId = "5", token = "tok123") {
    const path = `/overlay/${sessionId}?token=${token}`;
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/overlay/:sessionId" element={<OverlayPage />} />
                {/* Fallback for invalid sessionId (no param match) */}
                <Route path="/overlay/:bad" element={<OverlayPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

/**
 * Render with an invalid sessionId path (non-numeric) — still matches the
 * route pattern but the component rejects the value as invalid.
 */
function renderOverlayInvalid() {
    return render(
        <MemoryRouter initialEntries={["/overlay/abc?token=tok"]}>
            <Routes>
                <Route path="/overlay/:sessionId" element={<OverlayPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe("<OverlayPage>", () => {
    beforeEach(() => {
        subscribeStreamMock.mockReset();
    });

    it("shows 'Invalid overlay link' when sessionId is non-numeric", () => {
        subscribeStreamMock.mockReturnValue(fakeSource());
        renderOverlayInvalid();
        expect(screen.getByText("Invalid overlay link")).toBeInTheDocument();
    });

    it("shows 'Loading…' before the first SSE frame arrives", () => {
        subscribeStreamMock.mockReturnValue(fakeSource());
        renderOverlay();
        // … is the Unicode ellipsis character used in "Loading…"
        expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    it("opens the SSE subscription with correct sessionId and token", () => {
        subscribeStreamMock.mockReturnValue(fakeSource());
        renderOverlay("5", "my-token");
        expect(subscribeStreamMock).toHaveBeenCalledWith(
            5,
            "my-token",
            expect.objectContaining({
                onMessage: expect.any(Function),
                onClose: expect.any(Function),
            }),
        );
    });

    it("renders fixture rows when the first SSE frame arrives", async () => {
        let capturedHandlers: OverlayStreamHandlers | null = null;
        subscribeStreamMock.mockImplementation(
            (_id: number, _tok: string, handlers: OverlayStreamHandlers) => {
                capturedHandlers = handlers;
                return fakeSource();
            },
        );

        renderOverlay();

        const frame: PublicOverlayStreamMessage = {
            sessionId: 5,
            name: "Test session",
            endedAt: null,
            serverTime: Date.now(),
            missingFixtureIds: [],
            fixtures: [
                {
                    id: 1,
                    participants: [
                        {id: 10, name: "Arsenal", meta: {location: "home"}},
                        {id: 11, name: "Chelsea", meta: {location: "away"}},
                    ],
                    state: {short_name: "NS"},
                    scores: [],
                    periods: [],
                },
            ],
        };

        capturedHandlers!.onMessage(frame);

        await waitFor(() => expect(screen.getByText("Arsenal")).toBeInTheDocument());
        expect(screen.getByText("Chelsea")).toBeInTheDocument();
    });

    it("shows 'waiting for fixtures' message for an empty fixture list", async () => {
        let capturedHandlers: OverlayStreamHandlers | null = null;
        subscribeStreamMock.mockImplementation(
            (_id: number, _tok: string, handlers: OverlayStreamHandlers) => {
                capturedHandlers = handlers;
                return fakeSource();
            },
        );

        renderOverlay();

        const frame: PublicOverlayStreamMessage = {
            sessionId: 5,
            name: "Empty session",
            endedAt: null,
            serverTime: Date.now(),
            missingFixtureIds: [],
            fixtures: [],
        };
        capturedHandlers!.onMessage(frame);

        await waitFor(() =>
            expect(screen.getByText(/waiting for fixtures/i)).toBeInTheDocument(),
        );
    });

    it("renders the running clock for a ticking fixture", async () => {
        let capturedHandlers: OverlayStreamHandlers | null = null;
        subscribeStreamMock.mockImplementation(
            (_id: number, _tok: string, handlers: OverlayStreamHandlers) => {
                capturedHandlers = handlers;
                return fakeSource();
            },
        );

        renderOverlay();

        const serverTime = Date.now();
        const frame: PublicOverlayStreamMessage = {
            sessionId: 5,
            name: "Test",
            endedAt: null,
            serverTime,
            missingFixtureIds: [],
            fixtures: [
                {
                    id: 1,
                    participants: [
                        {id: 10, name: "Arsenal", meta: {location: "home"}},
                        {id: 11, name: "Chelsea", meta: {location: "away"}},
                    ],
                    state: {short_name: "1H"},
                    scores: [],
                    periods: [{ticking: true, minutes: 32, seconds: 0}],
                },
            ],
        };
        capturedHandlers!.onMessage(frame);

        await waitFor(() => {
            const timerEls = document.querySelectorAll("span");
            const timerEl = Array.from(timerEls).find(el => el.textContent?.startsWith("32:"));
            expect(timerEl).toBeTruthy();
        });
    });

    it("renders the score for a fixture with CURRENT scores", async () => {
        let capturedHandlers: OverlayStreamHandlers | null = null;
        subscribeStreamMock.mockImplementation(
            (_id: number, _tok: string, handlers: OverlayStreamHandlers) => {
                capturedHandlers = handlers;
                return fakeSource();
            },
        );

        renderOverlay();

        const frame: PublicOverlayStreamMessage = {
            sessionId: 5,
            name: "Test",
            endedAt: null,
            serverTime: Date.now(),
            missingFixtureIds: [],
            fixtures: [
                {
                    id: 1,
                    participants: [
                        {id: 10, name: "Arsenal", meta: {location: "home"}},
                        {id: 11, name: "Chelsea", meta: {location: "away"}},
                    ],
                    state: {short_name: "FT"},
                    scores: [
                        {description: "CURRENT", score: {goals: 3, participant: "home"}},
                        {description: "CURRENT", score: {goals: 1, participant: "away"}},
                    ],
                    periods: [],
                },
            ],
        };
        capturedHandlers!.onMessage(frame);

        await waitFor(() => expect(screen.getByText("3 – 1")).toBeInTheDocument());
    });
});

/**
 * Component tests for <SessionDetail />.
 *
 * SessionRequestClient is mocked at the module boundary so no HTTP happens.
 * We drive the component with various API responses and verify rendered output
 * plus key user interactions (end session, detach fixture).
 *
 * NOTE: <SessionDetail> uses `useParams({ id })` which requires the component
 * to be rendered inside a Route with the `:id` pattern. We use renderWithProviders
 * with a wrapped Routes/Route to supply the param correctly.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {Routes, Route} from "react-router-dom";

const {getOneMock, getLiveMock, endMock, detachMock, rotateOverlayTokenMock} = vi.hoisted(() => ({
    getOneMock: vi.fn(),
    getLiveMock: vi.fn(),
    endMock: vi.fn(),
    detachMock: vi.fn(),
    rotateOverlayTokenMock: vi.fn(),
}));

vi.mock("../../../../src/clients/SessionRequestClient", () => ({
    SessionRequestClient: vi.fn().mockImplementation(() => ({
        getOne: getOneMock,
        getLive: getLiveMock,
        end: endMock,
        detachFixture: detachMock,
        rotateOverlayToken: rotateOverlayTokenMock,
        // AttachFixturesPanel inside SessionDetail also uses SessionRequestClient
        attachFixture: vi.fn(),
    })),
}));

// AttachFixturesPanel also fetches fixtures — stub that too
const {getByDateMock} = vi.hoisted(() => ({getByDateMock: vi.fn()}));
vi.mock("../../../../src/clients/FixtureRequestClient", () => ({
    FixtureRequestClient: vi.fn().mockImplementation(() => ({
        getByDate: getByDateMock,
    })),
}));

import {SessionDetail} from "../../../../src/Components/sessions/SessionDetail";
import {renderWithProviders} from "../../../renderWithProviders";
import type {SessionDetail as SessionDetailModel} from "../../../../src/clients/SessionRequestClient";
import type {GetLiveSessionResponse} from "../../../../src/clients/SessionRequestClient";

const fakeDetail: SessionDetailModel = {
    id: 7,
    name: "Saturday watchalong",
    endedAt: null,
    createdAt: "2025-06-01T10:00:00Z",
    updatedAt: "2025-06-01T10:00:00Z",
    overlayUrl: "/overlay/abc?token=tok",
    fixtureIds: [101, 102],
};

const fakeLive: GetLiveSessionResponse = {
    sessionId: 7,
    fixtures: [
        {
            id: 101,
            name: "Arsenal vs Chelsea",
            starting_at: "2025-06-01T15:00:00Z",
            participants: [
                {id: 10, name: "Arsenal", meta: {location: "home"}},
                {id: 11, name: "Chelsea", meta: {location: "away"}},
            ],
            state: {short_name: "NS"},
            scores: [],
        },
    ],
    missingFixtureIds: [102],
};

/**
 * Wrap SessionDetail in a Route so useParams can resolve `:id`.
 * We use renderWithProviders for auth/access-control context, passing the
 * component as a wrapped Routes element.
 */
function renderDetail(idParam = "7") {
    const Wrapped = () => (
        <Routes>
            <Route path="/sessions/:id" element={<SessionDetail />} />
        </Routes>
    );
    return renderWithProviders(<Wrapped />, {
        initialEntries: [`/sessions/${idParam}`],
    });
}

describe("<SessionDetail>", () => {
    beforeEach(() => {
        getOneMock.mockReset();
        getLiveMock.mockReset();
        endMock.mockReset();
        detachMock.mockReset();
        rotateOverlayTokenMock.mockReset();
        getByDateMock.mockReset();
        getByDateMock.mockResolvedValue([]);
        localStorage.setItem("token", "test-jwt");
    });

    it("shows a spinner while loading", () => {
        getOneMock.mockReturnValue(new Promise(() => {}));
        getLiveMock.mockReturnValue(new Promise(() => {}));
        renderDetail();
        expect(document.querySelector(".ant-spin")).toBeInTheDocument();
    });

    it("renders the session name after loading", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() =>
            expect(screen.getByText("Saturday watchalong")).toBeInTheDocument(),
        );
    });

    it("shows Active tag for active sessions", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("shows Ended tag for ended sessions", async () => {
        const endedDetail = {...fakeDetail, endedAt: "2025-06-01T22:00:00Z"};
        getOneMock.mockResolvedValueOnce(endedDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        // Use getAllByText since the table column header "Ended" also appears
        expect(screen.getAllByText("Ended").length).toBeGreaterThan(0);
        // Specifically check the Antd Tag element (not the column header)
        const tags = document.querySelectorAll(".ant-tag");
        const endedTag = Array.from(tags).find(t => t.textContent === "Ended");
        expect(endedTag).toBeTruthy();
    });

    it("shows an error alert for an invalid (non-numeric) session id", async () => {
        renderDetail("not-a-number");
        await waitFor(() =>
            expect(screen.getByText("Session not available")).toBeInTheDocument(),
        );
    });

    it("shows an error alert when getOne rejects", async () => {
        getOneMock.mockRejectedValueOnce(new Error("Not found"));
        getLiveMock.mockRejectedValueOnce(new Error("Not found"));
        renderDetail();
        await waitFor(() =>
            expect(screen.getByText("Session not available")).toBeInTheDocument(),
        );
    });

    it("renders attached fixture rows with participant names", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Arsenal"));
        expect(screen.getByText("Chelsea")).toBeInTheDocument();
    });

    it("marks missing fixtures with 'Not in cache' tag", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Not in cache"));
    });

    it("shows an 'End session' button that is enabled for active sessions", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        const endBtn = screen.getByRole("button", {name: /end session/i});
        expect(endBtn).not.toBeDisabled();
    });

    it("disables 'End session' button for already-ended sessions", async () => {
        const endedDetail = {...fakeDetail, endedAt: "2025-06-01T22:00:00Z"};
        getOneMock.mockResolvedValueOnce(endedDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        const endBtn = screen.getByRole("button", {name: /end session/i});
        expect(endBtn).toBeDisabled();
    });

    it("hides the 'Add fixtures' panel for ended sessions", async () => {
        const endedDetail = {...fakeDetail, endedAt: "2025-06-01T22:00:00Z"};
        getOneMock.mockResolvedValueOnce(endedDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        expect(screen.queryByText("Add fixtures")).not.toBeInTheDocument();
    });

    it("shows the overlay URL input field", async () => {
        getOneMock.mockResolvedValueOnce(fakeDetail);
        getLiveMock.mockResolvedValueOnce(fakeLive);
        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));
        const input = screen.getByDisplayValue(/overlay\/abc/);
        expect(input).toBeInTheDocument();
    });

    it("shows 'No fixtures attached yet' when fixtureIds is empty", async () => {
        const emptyDetail = {...fakeDetail, fixtureIds: []};
        getOneMock.mockResolvedValueOnce(emptyDetail);
        getLiveMock.mockResolvedValueOnce({...fakeLive, fixtures: [], missingFixtureIds: []});
        renderDetail();
        await waitFor(() =>
            expect(screen.getByText("No fixtures attached yet")).toBeInTheDocument(),
        );
    });

    it("calls end() when the End session popconfirm is confirmed", async () => {
        const user = userEvent.setup();
        getOneMock.mockResolvedValue(fakeDetail);
        getLiveMock.mockResolvedValue(fakeLive);
        endMock.mockResolvedValueOnce({...fakeDetail, endedAt: "2025-06-01T22:00:00Z"});

        renderDetail();
        await waitFor(() => screen.getByText("Saturday watchalong"));

        // Click the "End session" trigger button to open the Popconfirm
        await user.click(screen.getByRole("button", {name: /end session/i}));

        // After opening there are two "End session" buttons: the trigger and
        // the Popconfirm's primary confirm button. Click the primary one.
        await waitFor(() => {
            const btns = screen.getAllByRole("button", {name: /end session/i});
            expect(btns.length).toBeGreaterThan(1);
        });
        const endBtns = screen.getAllByRole("button", {name: /end session/i});
        // The Popconfirm confirm button has ant-btn-primary class
        const confirmBtn = endBtns.find(b => b.classList.contains("ant-btn-primary"));
        expect(confirmBtn).toBeTruthy();
        await user.click(confirmBtn!);

        await waitFor(() => expect(endMock).toHaveBeenCalledWith(7));
    });
});

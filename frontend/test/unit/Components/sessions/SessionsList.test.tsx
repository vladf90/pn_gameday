/**
 * Component tests for <SessionsList />.
 *
 * SessionRequestClient is mocked at the module boundary. We drive the
 * component with various API responses (empty, populated, error) and assert
 * on rendered output and user interactions.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {listMock, createMock} = vi.hoisted(() => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
}));

vi.mock("../../../../src/clients/SessionRequestClient", () => ({
    SessionRequestClient: vi.fn().mockImplementation(() => ({
        list: listMock,
        create: createMock,
    })),
}));

import {SessionsList} from "../../../../src/Components/sessions/SessionsList";
import {renderWithProviders} from "../../../renderWithProviders";
import type {SessionSummary} from "../../../../src/clients/SessionRequestClient";

const fakeSessions: SessionSummary[] = [
    {
        id: 1,
        name: "Saturday watchalong",
        endedAt: null,
        createdAt: "2025-06-01T10:00:00Z",
        updatedAt: "2025-06-01T10:00:00Z",
        overlayUrl: "/overlay/abc",
    },
    {
        id: 2,
        name: "Sunday games",
        endedAt: "2025-06-02T20:00:00Z",
        createdAt: "2025-06-01T09:00:00Z",
        updatedAt: "2025-06-02T20:00:00Z",
        overlayUrl: "/overlay/def",
    },
];

describe("<SessionsList>", () => {
    beforeEach(() => {
        listMock.mockReset();
        createMock.mockReset();
        localStorage.setItem("token", "test-jwt");
    });

    it("shows a spinner while loading", () => {
        // Never resolves within the test
        listMock.mockReturnValue(new Promise(() => {}));
        renderWithProviders(<SessionsList />);
        // Antd Spin renders an element with role="img" and aria-label containing "loading"
        // or a .ant-spin element. Check for the loading indicator.
        expect(document.querySelector(".ant-spin")).toBeInTheDocument();
    });

    it("renders session rows after successful load", async () => {
        listMock.mockResolvedValueOnce(fakeSessions);
        renderWithProviders(<SessionsList />);
        await waitFor(() => expect(screen.getByText("Saturday watchalong")).toBeInTheDocument());
        expect(screen.getByText("Sunday games")).toBeInTheDocument();
    });

    it("shows Active tag for sessions with no endedAt", async () => {
        listMock.mockResolvedValueOnce(fakeSessions);
        renderWithProviders(<SessionsList />);
        await waitFor(() => screen.getByText("Saturday watchalong"));
        // There should be at least one "Active" tag
        expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });

    it("shows Ended tag for sessions with an endedAt value", async () => {
        listMock.mockResolvedValueOnce(fakeSessions);
        renderWithProviders(<SessionsList />);
        await waitFor(() => screen.getByText("Sunday games"));
        expect(screen.getAllByText("Ended").length).toBeGreaterThan(0);
    });

    it("shows empty state message when there are no active sessions", async () => {
        listMock.mockResolvedValueOnce([]);
        renderWithProviders(<SessionsList />);
        await waitFor(() =>
            expect(screen.getByText("No active sessions")).toBeInTheDocument(),
        );
    });

    it("shows error alert when the client throws", async () => {
        listMock.mockRejectedValueOnce(new Error("Server error"));
        renderWithProviders(<SessionsList />);
        await waitFor(() =>
            expect(screen.getByText("Could not load sessions")).toBeInTheDocument(),
        );
    });

    it("opens the 'New session' modal when the button is clicked", async () => {
        listMock.mockResolvedValueOnce(fakeSessions);
        const user = userEvent.setup();
        renderWithProviders(<SessionsList />);
        await waitFor(() => screen.getByText("Saturday watchalong"));
        await user.click(screen.getByRole("button", {name: /new session/i}));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("calls list(all) when 'Show ended' toggle is switched on", async () => {
        listMock.mockResolvedValue([]);
        const user = userEvent.setup();
        renderWithProviders(<SessionsList />);
        await waitFor(() => expect(listMock).toHaveBeenCalledWith("active"));
        listMock.mockClear();
        listMock.mockResolvedValueOnce([]);
        const toggle = screen.getByRole("switch");
        await user.click(toggle);
        await waitFor(() => expect(listMock).toHaveBeenCalledWith("all"));
    });

    it("shows 'No sessions yet' empty state after toggling Show ended with no results", async () => {
        listMock.mockResolvedValue([]);
        const user = userEvent.setup();
        renderWithProviders(<SessionsList />);
        await waitFor(() => screen.getByText("No active sessions"));
        const toggle = screen.getByRole("switch");
        await user.click(toggle);
        await waitFor(() =>
            expect(screen.getByText("No sessions yet")).toBeInTheDocument(),
        );
    });
});

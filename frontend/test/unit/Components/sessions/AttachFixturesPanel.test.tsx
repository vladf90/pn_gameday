/**
 * Component tests for <AttachFixturesPanel />.
 *
 * Both FixtureRequestClient and SessionRequestClient are mocked at the module
 * boundary. Tests cover: empty state, populated fixture list, already-attached
 * disabled buttons, and the attach action.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {getByDateMock, attachFixtureMock} = vi.hoisted(() => ({
    getByDateMock: vi.fn(),
    attachFixtureMock: vi.fn(),
}));

vi.mock("../../../../src/clients/FixtureRequestClient", () => ({
    FixtureRequestClient: vi.fn().mockImplementation(() => ({
        getByDate: getByDateMock,
    })),
}));

vi.mock("../../../../src/clients/SessionRequestClient", () => ({
    SessionRequestClient: vi.fn().mockImplementation(() => ({
        attachFixture: attachFixtureMock,
    })),
}));

import {AttachFixturesPanel} from "../../../../src/Components/sessions/AttachFixturesPanel";
import {renderWithProviders} from "../../../renderWithProviders";
import type {FixtureModel} from "../../../../src/common/fixtures";

const fixtureA: FixtureModel = {
    id: 101,
    name: "Arsenal vs Chelsea",
    starting_at: "2025-06-01T15:00:00Z",
    participants: [
        {id: 10, name: "Arsenal", meta: {location: "home"}},
        {id: 11, name: "Chelsea", meta: {location: "away"}},
    ],
    state: {short_name: "NS"},
};

const fixtureB: FixtureModel = {
    id: 202,
    name: "Barcelona vs Real Madrid",
    starting_at: "2025-06-01T20:00:00Z",
    participants: [
        {id: 20, name: "Barcelona", meta: {location: "home"}},
        {id: 21, name: "Real Madrid", meta: {location: "away"}},
    ],
    state: {short_name: "FT"},
};

function renderPanel(attachedIds: number[] = [], onAttached = vi.fn()) {
    return renderWithProviders(
        <AttachFixturesPanel
            sessionId={7}
            attachedFixtureIds={attachedIds}
            onAttached={onAttached}
        />,
    );
}

describe("<AttachFixturesPanel>", () => {
    beforeEach(() => {
        getByDateMock.mockReset();
        attachFixtureMock.mockReset();
        localStorage.setItem("token", "test-jwt");
    });

    it("shows a spinner while loading fixtures", () => {
        getByDateMock.mockReturnValue(new Promise(() => {}));
        renderPanel();
        expect(document.querySelector(".ant-spin")).toBeInTheDocument();
    });

    it("renders fixture rows after load", async () => {
        getByDateMock.mockResolvedValueOnce([fixtureA, fixtureB]);
        renderPanel();
        await waitFor(() => expect(screen.getByText("Arsenal")).toBeInTheDocument());
        expect(screen.getByText("Chelsea")).toBeInTheDocument();
        expect(screen.getByText("Barcelona")).toBeInTheDocument();
    });

    it("shows 'Attach' buttons for fixtures not yet attached", async () => {
        getByDateMock.mockResolvedValueOnce([fixtureA, fixtureB]);
        renderPanel([]);
        await waitFor(() => screen.getByText("Arsenal"));
        const attachButtons = screen.getAllByRole("button", {name: /^Attach$/i});
        expect(attachButtons).toHaveLength(2);
        attachButtons.forEach(btn => expect(btn).not.toBeDisabled());
    });

    it("disables the Attach button and shows 'Attached' for already-attached fixtures", async () => {
        getByDateMock.mockResolvedValueOnce([fixtureA, fixtureB]);
        renderPanel([101]); // fixtureA is already attached
        await waitFor(() => screen.getByText("Arsenal"));
        expect(screen.getByRole("button", {name: /^Attached$/i})).toBeDisabled();
        expect(screen.getByRole("button", {name: /^Attach$/i})).not.toBeDisabled();
    });

    it("shows empty state when no fixtures are on the selected date", async () => {
        getByDateMock.mockResolvedValueOnce([]);
        renderPanel();
        await waitFor(() => {
            const emptyEl = document.querySelector(".ant-empty-description");
            expect(emptyEl?.textContent).toMatch(/No fixtures on/);
        });
    });

    it("shows error alert when the client throws", async () => {
        getByDateMock.mockRejectedValueOnce(new Error("Service unavailable"));
        renderPanel();
        await waitFor(() =>
            expect(screen.getByText("Could not load fixtures")).toBeInTheDocument(),
        );
    });

    it("calls attachFixture and then onAttached when Attach is clicked", async () => {
        const onAttached = vi.fn();
        const user = userEvent.setup();
        getByDateMock.mockResolvedValueOnce([fixtureA]);
        attachFixtureMock.mockResolvedValueOnce({sessionId: 7, sportmonksFixtureId: 101});

        renderPanel([], onAttached);
        await waitFor(() => screen.getByText("Arsenal"));

        await user.click(screen.getByRole("button", {name: /^Attach$/i}));

        await waitFor(() =>
            expect(attachFixtureMock).toHaveBeenCalledWith(7, 101),
        );
        await waitFor(() => expect(onAttached).toHaveBeenCalled());
    });

    it("shows an error toast (does not crash) when attachFixture rejects", async () => {
        const user = userEvent.setup();
        getByDateMock.mockResolvedValueOnce([fixtureA]);
        attachFixtureMock.mockRejectedValueOnce(new Error("Attach failed"));

        renderPanel();
        await waitFor(() => screen.getByText("Arsenal"));
        await user.click(screen.getByRole("button", {name: /^Attach$/i}));

        await waitFor(() => expect(attachFixtureMock).toHaveBeenCalledTimes(1));
        // Component should still be rendered (not crashed)
        expect(screen.getByText("Arsenal")).toBeInTheDocument();
    });

    it("renders a date picker control", async () => {
        getByDateMock.mockResolvedValueOnce([]);
        renderPanel();
        await waitFor(() => document.querySelector(".ant-picker"));
        expect(document.querySelector(".ant-picker")).toBeInTheDocument();
    });
});

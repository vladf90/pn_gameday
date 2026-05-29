/**
 * Component tests for <FixturesByDate />.
 *
 * FixtureRequestClient is mocked at the module boundary.
 * Tests cover empty state, populated state, error state, and sorting behavior.
 */
import React from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";

const {getByDateMock} = vi.hoisted(() => ({getByDateMock: vi.fn()}));

vi.mock("../../../../src/clients/FixtureRequestClient", () => ({
    FixtureRequestClient: vi.fn().mockImplementation(() => ({
        getByDate: getByDateMock,
    })),
}));

import {FixturesByDate} from "../../../../src/Components/fixtures/FixturesByDate";
import {renderWithProviders} from "../../../renderWithProviders";
import type {FixtureModel} from "../../../../src/common/fixtures";

const fakeFixtures: FixtureModel[] = [
    {
        id: 1,
        name: "Arsenal vs Chelsea",
        starting_at: "2025-06-01T15:00:00Z",
        league: {id: 10, name: "Premier League"},
        participants: [
            {id: 100, name: "Arsenal", meta: {location: "home"}},
            {id: 101, name: "Chelsea", meta: {location: "away"}},
        ],
        state: {short_name: "NS", state: "NS"},
        scores: [],
    },
    {
        id: 2,
        name: "Barcelona vs Real Madrid",
        starting_at: "2025-06-01T20:00:00Z",
        league: {id: 20, name: "La Liga"},
        participants: [
            {id: 200, name: "Barcelona", meta: {location: "home"}},
            {id: 201, name: "Real Madrid", meta: {location: "away"}},
        ],
        state: {short_name: "FT", state: "FT"},
        scores: [
            {description: "CURRENT", score: {goals: 2, participant: "home"}},
            {description: "CURRENT", score: {goals: 1, participant: "away"}},
        ],
    },
];

describe("<FixturesByDate>", () => {
    beforeEach(() => {
        getByDateMock.mockReset();
        localStorage.setItem("token", "test-jwt");
    });

    it("shows a spinner while loading", () => {
        getByDateMock.mockReturnValue(new Promise(() => {}));
        renderWithProviders(<FixturesByDate />);
        expect(document.querySelector(".ant-spin")).toBeInTheDocument();
    });

    it("renders fixture rows after successful load", async () => {
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => expect(screen.getByText("Arsenal")).toBeInTheDocument());
        expect(screen.getByText("Chelsea")).toBeInTheDocument();
        expect(screen.getByText("Barcelona")).toBeInTheDocument();
        expect(screen.getByText("Real Madrid")).toBeInTheDocument();
    });

    it("shows the league name column", async () => {
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => screen.getByText("Premier League"));
        expect(screen.getByText("La Liga")).toBeInTheDocument();
    });

    it("shows score for fixtures with CURRENT scores", async () => {
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => screen.getByText("2 – 1"));
    });

    it("shows '—' score for fixtures without scores", async () => {
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => screen.getByText("Arsenal"));
        // The fixture with no scores should show '—'
        const cells = screen.getAllByText("—");
        expect(cells.length).toBeGreaterThan(0);
    });

    it("shows state tag for each fixture", async () => {
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => screen.getByText("NS"));
        expect(screen.getByText("FT")).toBeInTheDocument();
    });

    it("shows empty state when no fixtures are returned", async () => {
        getByDateMock.mockResolvedValueOnce([]);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => {
            // The empty state shows "No fixtures on <date>"
            const emptyEl = document.querySelector(".ant-empty-description");
            expect(emptyEl?.textContent).toMatch(/No fixtures on/);
        });
    });

    it("shows error alert when the client throws", async () => {
        getByDateMock.mockRejectedValueOnce(new Error("Failed to fetch"));
        renderWithProviders(<FixturesByDate />);
        await waitFor(() =>
            expect(screen.getByText("Could not load fixtures")).toBeInTheDocument(),
        );
    });

    it("sorts fixtures by league name, then starting_at (alphabetical)", async () => {
        // La Liga < Premier League alphabetically, so Barcelona row should appear first
        getByDateMock.mockResolvedValueOnce(fakeFixtures);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => screen.getByText("Arsenal"));
        const rows = document.querySelectorAll(".ant-table-row");
        expect(rows.length).toBe(2);
        // First row should be La Liga (Barcelona)
        expect(rows[0].textContent).toContain("Barcelona");
        // Second row should be Premier League (Arsenal)
        expect(rows[1].textContent).toContain("Arsenal");
    });

    it("renders the 'Sessions →' navigation link", async () => {
        getByDateMock.mockResolvedValueOnce([]);
        renderWithProviders(<FixturesByDate />);
        await waitFor(() => {
            expect(screen.getByRole("button", {name: /Sessions/i})).toBeInTheDocument();
        });
    });
});

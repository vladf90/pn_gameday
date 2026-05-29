/**
 * Smoke test for <Home />.
 *
 * Home is a thin layout shell with no logic — a single render test
 * verifies it mounts without errors and displays the expected heading.
 */
import React from "react";
import {describe, expect, it} from "vitest";
import {screen} from "@testing-library/react";
import {renderWithProviders} from "../../../renderWithProviders";
import {Home} from "../../../../src/Components/home/Home";

describe("<Home>", () => {
    it("renders without crashing and shows the page heading", () => {
        renderWithProviders(<Home />);
        expect(screen.getByRole("heading", {name: /pn_gameday/i})).toBeInTheDocument();
    });
});

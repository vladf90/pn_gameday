/**
 * Global setup for frontend tests.
 *
 * - Registers `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`).
 * - Cleans up the DOM after each test so renders don't leak between cases
 *   (React Testing Library's `render` mounts into `document.body`).
 */
import "@testing-library/jest-dom/vitest";
import {afterEach} from "vitest";
import {cleanup} from "@testing-library/react";

afterEach(() => {
    cleanup();
});

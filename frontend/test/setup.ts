/**
 * Global setup for frontend tests.
 *
 * - Registers `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`).
 * - Stubs `window.matchMedia` because jsdom doesn't ship one and Antd's
 *   responsive utilities call it during render — every component test
 *   would crash otherwise.
 * - Cleans up the DOM after each test so renders don't leak between cases
 *   (React Testing Library's `render` mounts into `document.body`).
 */
import "@testing-library/jest-dom/vitest";
import {afterEach, vi} from "vitest";
import {cleanup} from "@testing-library/react";

Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

afterEach(() => {
    cleanup();
});

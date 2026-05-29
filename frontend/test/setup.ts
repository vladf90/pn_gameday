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

// Silence the Antd `<Card>` `bodyStyle` / `headStyle` deprecation warnings.
//
// They come from `@refinedev/antd`'s `<AuthPage>` rendering an Antd Card with
// the pre-5.23 prop names. We can't fix it without upgrading to
// `@refinedev/antd` 6.x, which requires Refine core 5.x — a major bump worth
// its own ADR. Until then this filter keeps test output readable.
//
// Deliberately narrow: only the two specific Antd Card deprecations from the
// AuthPage path. New warnings should still surface — if you broaden the
// pattern, document why.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
    const first = args[0];
    if (
        typeof first === "string" &&
        /\[antd: Card\] `(bodyStyle|headStyle)` is deprecated/.test(first)
    ) {
        return;
    }
    originalConsoleError(...args);
};

afterEach(() => {
    cleanup();
});

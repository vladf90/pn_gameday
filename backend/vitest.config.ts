import {defineConfig} from "vitest/config";

/**
 * Backend test configuration.
 *
 * - Node environment (no jsdom — backend code runs on Node).
 * - Threads on by default for speed; tests must remain side-effect-free per file.
 * - `test:unit` script narrows to `src/**` so integration tests (added under
 *   `test/integration/` in issue #91) don't run by default.
 * - See `docs/adr/0009-testing-with-vitest.md` for context.
 */
export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        // Unit tests should be fast; the longer per-test budget for integration
        // tests is set inside their own test files / future integration config.
        testTimeout: 5_000,
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    },
});

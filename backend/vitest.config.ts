import {defineConfig} from "vitest/config";

/**
 * Backend test configuration.
 *
 * - Node environment (no jsdom — backend code runs on Node).
 * - Threads on by default for speed; tests must remain side-effect-free per file.
 * - Tests live under `test/<category>/`, mirroring `src/` structure underneath.
 *   The `test:unit` and `test:integration` scripts in package.json narrow to
 *   the matching subfolder; the default `test` script runs everything.
 * - By convention tests are never colocated with `src/` — the include glob
 *   below is `test`-only so a stray colocated test file would not be picked
 *   up silently. See `docs/adr/0009-testing-with-vitest.md`.
 */
export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        // Unit tests should be fast; the longer per-test budget for integration
        // tests is set inside their own test files / future integration config.
        testTimeout: 5_000,
        include: ["test/**/*.test.ts"],
    },
});

import {defineConfig} from "vitest/config";
import react from "@vitejs/plugin-react-swc";

/**
 * Frontend test configuration.
 *
 * - jsdom environment for React component tests.
 * - Tests live under `test/<category>/` mirroring `src/` underneath — they
 *   are NEVER colocated with source (matches backend convention). The include
 *   glob is `test`-only so a stray colocated test would not be picked up.
 * - `test/setup.ts` extends Vitest's `expect` with jest-dom matchers and
 *   registers RTL's `cleanup` after each test.
 * - See `docs/adr/0009-testing-with-vitest.md` for context.
 */
export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: false,
        setupFiles: ["./test/setup.ts"],
        include: ["test/**/*.test.{ts,tsx}"],
        css: false,
    },
});

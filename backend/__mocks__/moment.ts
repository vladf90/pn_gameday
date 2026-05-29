/**
 * Manual Vitest/Jest mock for `moment`.
 *
 * `DateValidator.ts` uses `import * as moment from "moment"` and calls
 * `moment(str, moment.ISO_8601)` — treating the namespace import as a
 * callable function. In production (ts-node / CJS) this works because the
 * CJS default export IS the callable. Under Vitest's ESM transform the
 * namespace is a plain object and is not callable.
 *
 * This manual mock is activated by `vi.mock("moment")` (no factory) in a
 * test file. It exports:
 *   - A callable `default` export (the thin moment shim).
 *   - `ISO_8601` as a named export so `moment.ISO_8601` resolves from the
 *     namespace.
 *
 * The shim accepts any string; it returns `{isValid: () => true}` when
 * `new Date(str)` yields a valid date, and `{isValid: () => false}` otherwise.
 * This faithfully approximates the subset of moment's behaviour that
 * DateValidator uses.
 */

function momentShim(dateStr: unknown, _format?: unknown): {isValid: () => boolean} {
    if (typeof dateStr !== "string" || dateStr.length === 0) {
        return {isValid: () => false};
    }
    const d = new Date(dateStr);
    return {isValid: () => !isNaN(d.getTime())};
}

(momentShim as unknown as Record<string, unknown>).ISO_8601 = "ISO_8601";

export default momentShim;
export const ISO_8601 = "ISO_8601";

/**
 * Abstraction over "which SportMonks fixture IDs should the poller refresh
 * on the next tick?". The default implementation (`SessionFixtureProvider`)
 * derives the set from `session_fixture` rows, but the indirection lets
 * later iterations swap in alternate sources (e.g. a curated allow-list, an
 * external scheduling system) without changing the poller.
 *
 * Implementations MUST return a deduplicated list. Sorting is the
 * implementation's choice but a stable order helps downstream consumers
 * and tests; the default impl sorts ascending.
 */
export interface FixtureSelectionProvider {
    getActiveFixtureIds(): Promise<number[]>;
}

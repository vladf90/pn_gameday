import {sportmonksLiveFixturesInMemory} from "./metrics";
import {LiveFixture} from "./types";

/**
 * In-memory cache of the latest live-fixture data, keyed by SportMonks
 * fixture ID. Nothing is persisted to Postgres — the snapshot is rebuilt
 * from the next `FixturePoller` tick after a restart.
 *
 * The store keeps the Prometheus gauge `sportmonks_live_fixtures_in_memory`
 * in sync after every mutation so a Grafana panel can show snapshot size
 * without needing to introspect the store directly.
 *
 * The poller (#7) is the only writer; `GET /sessions/:id/live` (#8) is the
 * only reader. Both are out of scope for this issue — we only ship the
 * store itself.
 */
export class LiveSnapshotStore {

    private readonly store: Map<number, LiveFixture> = new Map();

    /** Returns the snapshot for a single fixture, or `undefined` if absent. */
    get(fixtureId: number): LiveFixture | undefined {
        return this.store.get(fixtureId);
    }

    /**
     * Returns snapshots for the requested fixture IDs **in the order they
     * were requested**. IDs that are not in the store are simply skipped —
     * the caller cannot tell from the result alone which IDs were missing,
     * which matches the read-API contract (a fixture being briefly absent
     * after a poll tick is not an error).
     */
    getMany(fixtureIds: number[]): LiveFixture[] {
        const result: LiveFixture[] = [];
        for (const fixtureId of fixtureIds) {
            const fixture = this.store.get(fixtureId);
            if (fixture !== undefined) {
                result.push(fixture);
            }
        }
        return result;
    }

    /** Returns every snapshot currently held. Iteration order is insertion order. */
    getAll(): LiveFixture[] {
        return Array.from(this.store.values());
    }

    /**
     * Insert or overwrite entries for each fixture in the input. Does NOT
     * remove entries for fixtures absent from `fixtures` — use
     * `evictMissing` for that. This separation lets the poller process one
     * `/fixtures/multi` batch at a time without dropping entries from
     * other batches.
     */
    replaceMany(fixtures: LiveFixture[]): void {
        for (const fixture of fixtures) {
            this.store.set(fixture.id, fixture);
        }
        this.updateGauge();
    }

    /**
     * Drop every entry whose key is not in `activeFixtureIds`. Called by
     * the poller once per tick after refreshing the active set so the
     * snapshot does not grow unbounded as fixtures are detached from
     * sessions.
     */
    evictMissing(activeFixtureIds: number[]): void {
        const keep = new Set(activeFixtureIds);
        for (const fixtureId of Array.from(this.store.keys())) {
            if (!keep.has(fixtureId)) {
                this.store.delete(fixtureId);
            }
        }
        this.updateGauge();
    }

    private updateGauge(): void {
        sportmonksLiveFixturesInMemory.set(this.store.size);
    }
}

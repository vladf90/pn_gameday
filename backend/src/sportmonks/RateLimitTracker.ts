/**
 * In-memory tracker for SportMonks' per-entity hourly rate-limit buckets.
 *
 * Every SportMonks response carries a `rate_limit` block scoped to the entity
 * that was queried (e.g. `fixtures`, `teams`). The client feeds each response
 * into `record()`; readers can pull the latest state via `get()` or `getAll()`.
 *
 * Metrics wiring (Prometheus gauges) lands in issue #5 and will subscribe via
 * `getAll()` at scrape time, so this class deliberately stays metrics-agnostic.
 */
export interface RateLimitState {
    remaining: number;
    resetsInSeconds: number;
    lastUpdatedAt: Date;
}

export class RateLimitTracker {

    private readonly buckets: Map<string, RateLimitState> = new Map();

    record(entity: string, remaining: number, resetsInSeconds: number): void {
        this.buckets.set(entity, {
            remaining,
            resetsInSeconds,
            lastUpdatedAt: new Date(),
        });
    }

    get(entity: string): RateLimitState | undefined {
        return this.buckets.get(entity);
    }

    getAll(): Record<string, RateLimitState> {
        const out: Record<string, RateLimitState> = {};
        for (const [entity, state] of this.buckets.entries()) {
            out[entity] = state;
        }
        return out;
    }
}

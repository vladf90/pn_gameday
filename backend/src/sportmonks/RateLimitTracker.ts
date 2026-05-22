import {sportmonksRateLimitRemaining, sportmonksRateLimitResetSeconds} from "./metrics";

/**
 * In-memory tracker for SportMonks' per-entity hourly rate-limit buckets.
 *
 * Every SportMonks response carries a `rate_limit` block scoped to the entity
 * that was queried (e.g. `fixtures`, `teams`). The client feeds each response
 * into `record()`; readers can pull the latest state via `get()` or `getAll()`.
 *
 * Every call to `record()` also updates the corresponding Prometheus gauges
 * (`sportmonks_rate_limit_remaining` and `sportmonks_rate_limit_reset_seconds`)
 * so the metrics surface always matches the in-memory state — there is no
 * separate sync path to drift out of step.
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
        sportmonksRateLimitRemaining.labels(entity).set(remaining);
        sportmonksRateLimitResetSeconds.labels(entity).set(resetsInSeconds);
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

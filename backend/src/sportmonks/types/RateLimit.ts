/**
 * Parsed `rate_limit` block returned by every SportMonks response.
 *
 * SportMonks bills on a per-entity, per-hour quota model; every response
 * tells us how many calls are left for the entity that was just requested
 * and when its bucket resets.
 */
export interface RateLimit {
    /** Calls remaining in the current hourly bucket for this entity. */
    remaining: number;
    /** The entity whose bucket this measurement refers to (e.g. `fixtures`). */
    requestedEntity: string;
    /** Seconds until the bucket resets to the plan's hourly limit. */
    resetsInSeconds: number;
}

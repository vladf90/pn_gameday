import {Counter, Gauge, Histogram, Registry, collectDefaultMetrics} from "prom-client";

/**
 * Prometheus metrics for the SportMonks integration.
 *
 * Uses a dedicated `Registry` (not the global default) so that:
 *   - tests can construct fresh registries without leaking state across files,
 *   - downstream callers can scrape *only* SportMonks + Node runtime metrics
 *     at `GET /metrics` without picking up unrelated globals.
 *
 * Default Node.js runtime metrics (event loop lag, memory, GC, etc.) are
 * registered against the same registry so a single scrape covers both the
 * runtime and the SportMonks integration.
 *
 * Metric naming follows the Prometheus conventions called out in ADR 0001
 * (`_total` for counters, `_seconds` for time units).
 */
export const register = new Registry();

collectDefaultMetrics({register});

/** Outbound SportMonks calls, partitioned by entity, endpoint, and outcome. */
export const sportmonksApiCallsTotal = new Counter({
    name: "sportmonks_api_calls_total",
    help: "SportMonks API calls by entity, endpoint and outcome status.",
    labelNames: ["entity", "endpoint", "status"] as const,
    registers: [register],
});

/** End-to-end duration (seconds) of each SportMonks call. */
export const sportmonksApiCallDurationSeconds = new Histogram({
    name: "sportmonks_api_call_duration_seconds",
    help: "Duration of SportMonks API calls in seconds.",
    labelNames: ["entity", "endpoint"] as const,
    // Tail-friendly buckets — most calls land in the 100–500ms range,
    // anything past 5s is firmly in the "something is wrong" bucket.
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

/** Latest `rate_limit.remaining` value SportMonks reported per entity. */
export const sportmonksRateLimitRemaining = new Gauge({
    name: "sportmonks_rate_limit_remaining",
    help: "Latest remaining quota reported by SportMonks per entity.",
    labelNames: ["entity"] as const,
    registers: [register],
});

/** Latest `rate_limit.resets_in_seconds` value SportMonks reported per entity. */
export const sportmonksRateLimitResetSeconds = new Gauge({
    name: "sportmonks_rate_limit_reset_seconds",
    help: "Seconds until the SportMonks per-entity quota bucket resets.",
    labelNames: ["entity"] as const,
    registers: [register],
});

/** Count of HTTP 429 backoff events from SportMonks per entity. */
export const sportmonksRateLimitThrottledTotal = new Counter({
    name: "sportmonks_rate_limit_throttled_total",
    help: "Number of times SportMonks returned HTTP 429 per entity.",
    labelNames: ["entity"] as const,
    registers: [register],
});

/**
 * Size of the in-memory live-fixtures snapshot. Wired in #6
 * (`LiveSnapshotStore`); defined here so the metric exists at scrape time.
 */
export const sportmonksLiveFixturesInMemory = new Gauge({
    name: "sportmonks_live_fixtures_in_memory",
    help: "Number of live fixtures currently held in the in-memory snapshot store.",
    registers: [register],
});

/**
 * Size of the deduped active-fixture set. Wired in #7
 * (`FixturePoller`); defined here so the metric exists at scrape time.
 */
export const sportmonksActiveFixtureIds = new Gauge({
    name: "sportmonks_active_fixture_ids",
    help: "Number of unique fixture IDs across all active sessions.",
    registers: [register],
});

/**
 * Unix timestamp (seconds) of the last successful poller tick. Wired in #7.
 */
export const sportmonksPollerLastSuccessTimestamp = new Gauge({
    name: "sportmonks_poller_last_success_timestamp",
    help: "Unix timestamp (seconds) of the last successful SportMonks poller tick.",
    registers: [register],
});

/**
 * Best-effort endpoint label derivation: strips numeric ID segments and any
 * trailing query string so `/fixtures/multi/1,2,3?include=...` collapses to
 * `/fixtures/multi`. We deliberately keep the path *template* low-cardinality
 * — high-cardinality labels would blow up Prometheus time-series storage.
 */
export function endpointLabel(path: string): string {
    const withoutQuery = path.split("?")[0];
    const segments = withoutQuery.split("/").filter((s) => s.length > 0);
    const cleaned = segments.filter((segment) => {
        // Drop pure-number segments and comma-joined ID lists (multi-ID paths).
        if (/^\d+$/.test(segment)) {
            return false;
        }
        if (/^[\d,]+$/.test(segment) && segment.includes(",")) {
            return false;
        }
        return true;
    });
    return "/" + cleaned.join("/");
}

/**
 * Heuristic entity-label derivation from a path template, used when the
 * SportMonks response does not surface `requested_entity` (e.g. on errors
 * before parsing, or non-football endpoints).
 *
 * Returns `"unknown"` if the path is unrecognised — callers should pass the
 * `requested_entity` from the response envelope when available.
 */
export function entityLabelFromPath(path: string): string {
    const template = endpointLabel(path).toLowerCase();
    if (template.includes("/fixtures")) {
        return "Fixture";
    }
    if (template.includes("/teams")) {
        return "Team";
    }
    if (template.includes("/players")) {
        return "Player";
    }
    if (template.includes("/leagues")) {
        return "League";
    }
    if (template.includes("/seasons")) {
        return "Season";
    }
    if (template.includes("/types")) {
        return "Type";
    }
    return "unknown";
}

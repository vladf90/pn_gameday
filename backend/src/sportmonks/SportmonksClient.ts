import {Logger} from "../Logger";
import {Context, ContextFactory} from "../Logger/Context";
import {RateLimitTracker} from "./RateLimitTracker";
import {
    endpointLabel,
    entityLabelFromPath,
    sportmonksApiCallDurationSeconds,
    sportmonksApiCallsTotal,
    sportmonksRateLimitThrottledTotal,
} from "./metrics";
import {RateLimit, SportmonksResponseEnvelope} from "./types";

/**
 * Configuration accepted by `SportmonksClient`.
 *
 * `fetchImpl` is injectable so tests / scratch scripts can swap in a stub
 * without monkey-patching the global. In production we use Node 20's
 * built-in `fetch` — no axios dependency.
 */
export interface SportmonksClientConfig {
    apiToken: string;
    baseUrl: string;
    /** Defaults to `globalThis.fetch` (Node 20+). */
    fetchImpl?: typeof fetch;
    /** Initial backoff used when SportMonks does not surface `resets_in_seconds`. */
    initialBackoffMs?: number;
    /** Max retries on `HTTP 429`. */
    maxRetries?: number;
}

export interface GetOptions {
    /** Optional context for structured logging; falls back to a process context. */
    ctx?: Context;
    /**
     * Tag attached to logs and used in error messages. Defaults to "unknown";
     * callers like the fixture poller should pass `"fixtures"` etc.
     */
    entity?: string;
}

export interface SportmonksGetResult<T> {
    data: T;
    rateLimit: RateLimit | undefined;
    /** True if at least one HTTP 429 was observed during this call. */
    throttled: boolean;
}

/**
 * Typed HTTP wrapper around SportMonks v3.
 *
 * Error-handling contract:
 *   - `get()` rejects with the **raw** error (typically a `SportmonksHttpError`).
 *     Callers triggered by HTTP handlers wrap it in `ServiceError(502)` themselves;
 *     background callers (the fixture poller, added in issue #6) can log + count
 *     and continue on the next tick. This keeps the client policy-free.
 *   - `HTTP 429` is retried with exponential backoff capped at the bucket's
 *     `resets_in_seconds`. The result flags `throttled: true` so callers
 *     know they hit the limit (metrics wiring lands in #5).
 */
export class SportmonksClient {

    private readonly logger = new Logger("SportmonksClient");
    private readonly apiToken: string;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly initialBackoffMs: number;
    private readonly maxRetries: number;

    constructor(
        config: SportmonksClientConfig,
        private readonly rateLimitTracker: RateLimitTracker,
    ) {
        this.apiToken = config.apiToken;
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
        this.initialBackoffMs = config.initialBackoffMs ?? 500;
        this.maxRetries = config.maxRetries ?? 5;

        if (typeof this.fetchImpl !== "function") {
            throw new Error("SportmonksClient: global fetch is not available; running on Node < 18?");
        }
    }

    /**
     * Issue a GET against the SportMonks API. Auth token is sent via the
     * `Authorization` header (never as a query param) and is never logged.
     */
    async get<T>(
        path: string,
        query?: Record<string, string | number>,
        options: GetOptions = {},
    ): Promise<SportmonksGetResult<T>> {
        const ctx = options.ctx ?? ContextFactory.createProcessContext("sportmonks");
        const entity = options.entity ?? "unknown";
        const url = this.buildUrl(path, query);
        // Logged endpoint is the path only — query may contain selection
        // criteria we want, but never the token (which is header-only anyway).
        const loggedEndpoint = this.stripQuery(path);
        // Metric labels: keep cardinality bounded. `endpointLabel` strips
        // numeric ID segments so `/fixtures/multi/1,2,3` collapses to
        // `/fixtures/multi`. Entity falls back to a path-based heuristic until
        // we observe `requested_entity` in the response (see below).
        const endpointMetricLabel = endpointLabel(loggedEndpoint);
        const fallbackEntityLabel = options.entity ?? entityLabelFromPath(loggedEndpoint);

        let throttled = false;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            const startedAt = Date.now();
            const response = await this.fetchImpl(url, {
                method: "GET",
                headers: {
                    "Authorization": this.apiToken,
                    "Accept": "application/json",
                },
            });
            const durationMs = Date.now() - startedAt;
            const durationSeconds = durationMs / 1000;

            if (response.status === 429) {
                throttled = true;
                sportmonksApiCallsTotal
                    .labels(fallbackEntityLabel, endpointMetricLabel, "throttled")
                    .inc();
                sportmonksRateLimitThrottledTotal.labels(fallbackEntityLabel).inc();
                sportmonksApiCallDurationSeconds
                    .labels(fallbackEntityLabel, endpointMetricLabel)
                    .observe(durationSeconds);
                const waitSeconds = this.parseRetryAfterSeconds(response);
                this.logger.warning(ctx, "SportMonks throttled", {
                    entity,
                    endpoint: loggedEndpoint,
                    status: 429,
                    duration_ms: durationMs,
                    attempt: attempt + 1,
                    wait_seconds: waitSeconds,
                });
                if (attempt >= this.maxRetries) {
                    throw new SportmonksHttpError(
                        `SportMonks throttled (HTTP 429) after ${attempt + 1} attempts`,
                        429,
                        entity,
                        loggedEndpoint,
                    );
                }
                await this.sleep(this.computeBackoffMs(attempt, waitSeconds));
                continue;
            }

            let envelope: SportmonksResponseEnvelope<T> | undefined;
            let parseError: unknown;
            try {
                envelope = await response.json() as SportmonksResponseEnvelope<T>;
            } catch (e) {
                parseError = e;
            }

            const rateLimit = this.extractRateLimit(envelope);
            if (rateLimit) {
                this.rateLimitTracker.record(
                    rateLimit.requestedEntity,
                    rateLimit.remaining,
                    rateLimit.resetsInSeconds,
                );
            }

            // Prefer the SportMonks-reported entity label so metrics group by
            // the canonical name (e.g. "Fixture") rather than our heuristic.
            const resolvedEntityLabel = rateLimit?.requestedEntity ?? fallbackEntityLabel;

            sportmonksApiCallDurationSeconds
                .labels(resolvedEntityLabel, endpointMetricLabel)
                .observe(durationSeconds);

            if (!response.ok) {
                sportmonksApiCallsTotal
                    .labels(resolvedEntityLabel, endpointMetricLabel, "error")
                    .inc();
                this.logger.error(ctx, "SportMonks call failed", {
                    entity,
                    endpoint: loggedEndpoint,
                    status: response.status,
                    duration_ms: durationMs,
                    remaining: rateLimit?.remaining,
                });
                throw new SportmonksHttpError(
                    `SportMonks call failed: HTTP ${response.status}`,
                    response.status,
                    entity,
                    loggedEndpoint,
                );
            }

            if (parseError || !envelope) {
                sportmonksApiCallsTotal
                    .labels(resolvedEntityLabel, endpointMetricLabel, "error")
                    .inc();
                this.logger.error(ctx, "SportMonks response was not valid JSON", {
                    entity,
                    endpoint: loggedEndpoint,
                    status: response.status,
                    duration_ms: durationMs,
                });
                throw new SportmonksHttpError(
                    "SportMonks response was not valid JSON",
                    response.status,
                    entity,
                    loggedEndpoint,
                );
            }

            sportmonksApiCallsTotal
                .labels(resolvedEntityLabel, endpointMetricLabel, "success")
                .inc();
            this.logger.info(ctx, "SportMonks call ok", {
                entity,
                endpoint: loggedEndpoint,
                status: response.status,
                duration_ms: durationMs,
                remaining: rateLimit?.remaining,
            });

            return {
                data: envelope.data,
                rateLimit,
                throttled,
            };
        }

        // Defensive — the loop only exits via return or throw above.
        throw new SportmonksHttpError(
            "SportMonks client exhausted retries without a definitive response",
            0,
            entity,
            loggedEndpoint,
        );
    }

    private buildUrl(path: string, query?: Record<string, string | number>): string {
        const normalisedPath = path.startsWith("/") ? path : `/${path}`;
        const url = new URL(`${this.baseUrl}${normalisedPath}`);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    private stripQuery(path: string): string {
        const i = path.indexOf("?");
        return i === -1 ? path : path.slice(0, i);
    }

    private extractRateLimit(envelope: SportmonksResponseEnvelope<unknown> | undefined): RateLimit | undefined {
        const block = envelope?.rate_limit;
        if (!block) {
            return undefined;
        }
        if (
            typeof block.remaining !== "number" ||
            typeof block.requested_entity !== "string" ||
            typeof block.resets_in_seconds !== "number"
        ) {
            return undefined;
        }
        return {
            remaining: block.remaining,
            requestedEntity: block.requested_entity,
            resetsInSeconds: block.resets_in_seconds,
        };
    }

    /**
     * Exponential backoff with full jitter, capped at the bucket's
     * `resets_in_seconds` (or `Retry-After` header) when SportMonks provides one.
     */
    private computeBackoffMs(attempt: number, capSeconds: number | undefined): number {
        const exponential = this.initialBackoffMs * Math.pow(2, attempt);
        const jittered = Math.floor(Math.random() * exponential) + this.initialBackoffMs;
        if (capSeconds !== undefined && capSeconds >= 0) {
            const capMs = capSeconds * 1000;
            return Math.min(jittered, capMs);
        }
        return jittered;
    }

    private parseRetryAfterSeconds(response: Response): number | undefined {
        const header = response.headers.get("retry-after");
        if (!header) {
            return undefined;
        }
        const asNumber = Number(header);
        if (!Number.isNaN(asNumber)) {
            return asNumber;
        }
        const asDate = Date.parse(header);
        if (!Number.isNaN(asDate)) {
            const deltaMs = asDate - Date.now();
            return Math.max(0, Math.ceil(deltaMs / 1000));
        }
        return undefined;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Raw HTTP-level error from the SportMonks client. Handler-triggered
 * callers wrap this in `ServiceError(502)`; the background fixture poller
 * (#6) logs + counts and continues.
 */
export class SportmonksHttpError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly entity: string,
        public readonly endpoint: string,
    ) {
        super(message);
        this.name = "SportmonksHttpError";
    }
}

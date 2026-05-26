import {Logger} from "../../Logger";
import {RateLimitTracker} from "../RateLimitTracker";
import {
    endpointLabel,
    sportmonksApiCallDurationSeconds,
    sportmonksApiCallsTotal,
    sportmonksRateLimitThrottledTotal,
} from "../metrics";
import {SportmonksResponseEnvelope} from "../types";

export interface SportmonksHttpClientConfig {
    apiToken: string;
    baseUrl: string;
    /** Defaults to `globalThis.fetch` (Node 20+). */
    fetchImpl?: typeof fetch;
}

export interface GetOptions {
    /**
     * Canonical entity label used for metrics (`entity` label) and error
     * messages. Entity clients pin this (e.g. `"Fixture"`, `"League"`).
     */
    entity: string;
}

/**
 * Pure HTTP transport for SportMonks v3.
 *
 * Single-attempt — no retry, no backoff. `HTTP 429` throws like any other
 * non-2xx (see ADR 0002). Callers that want retry wrap this client.
 *
 * Responsibilities kept here:
 *   - Auth header injection (token is header-only, never logged)
 *   - Response envelope unwrapping — returns `envelope.data` directly
 *   - Rate-limit block extraction → `RateLimitTracker`
 *   - Prometheus metrics: `sportmonks_api_calls_total`,
 *     `sportmonks_api_call_duration_seconds`,
 *     `sportmonks_rate_limit_throttled_total`
 *
 * Error contract: rejects with `SportmonksHttpError` on any non-2xx or
 * malformed JSON. Handler-triggered callers wrap in `ServiceError(502)`;
 * background callers (the fixture poller) log + count and continue.
 */
export class SportmonksHttpClient {

    private readonly logger = new Logger("SportmonksHttpClient");
    private readonly apiToken: string;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;

    constructor(
        config: SportmonksHttpClientConfig,
        private readonly rateLimitTracker: RateLimitTracker,
    ) {
        this.apiToken = config.apiToken;
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.fetchImpl = config.fetchImpl ?? globalThis.fetch;

        if (typeof this.fetchImpl !== "function") {
            throw new Error("SportmonksHttpClient: global fetch is not available; running on Node < 18?");
        }
    }

    /**
     * Issue a GET against the SportMonks API. Auth token is sent via the
     * `Authorization` header (never as a query param) and is never logged.
     *
     * Returns the unwrapped `envelope.data`. The `rate_limit` block is
     * pushed into `RateLimitTracker` as a side effect; callers that need
     * the values read from the tracker.
     */
    async get<T>(
        path: string,
        query: Record<string, string | number> | undefined,
        options: GetOptions,
    ): Promise<T> {
        const entity = options.entity;
        const url = this.buildUrl(path, query);
        const loggedEndpoint = this.stripQuery(path);
        const endpointMetricLabel = endpointLabel(loggedEndpoint);
        // HTTP detail fields rendered inline in the log line by the formatter
        // (ADR 0007). `SportmonksHttpClient` only issues GETs today.
        const httpFields = {direction: "outbound", method: "GET", url};

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

        sportmonksApiCallDurationSeconds
            .labels(entity, endpointMetricLabel)
            .observe(durationSeconds);

        if (response.status === 429) {
            sportmonksApiCallsTotal
                .labels(entity, endpointMetricLabel, "error")
                .inc();
            sportmonksRateLimitThrottledTotal.labels(entity).inc();
            this.logger.warning("throttled", {
                ...httpFields,
                entity,
                endpoint: loggedEndpoint,
                statusCode: 429,
                duration_ms: durationMs,
            });
            throw new SportmonksHttpError(
                "SportMonks throttled (HTTP 429)",
                429,
                entity,
                loggedEndpoint,
            );
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

        if (!response.ok) {
            sportmonksApiCallsTotal
                .labels(entity, endpointMetricLabel, "error")
                .inc();
            this.logger.error("call failed", {
                ...httpFields,
                entity,
                endpoint: loggedEndpoint,
                statusCode: response.status,
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
                .labels(entity, endpointMetricLabel, "error")
                .inc();
            this.logger.error("response was not valid JSON", {
                ...httpFields,
                entity,
                endpoint: loggedEndpoint,
                statusCode: response.status,
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
            .labels(entity, endpointMetricLabel, "success")
            .inc();
        this.logger.info("", {
            ...httpFields,
            entity,
            endpoint: loggedEndpoint,
            statusCode: response.status,
            duration_ms: durationMs,
            remaining: rateLimit?.remaining,
        });

        return envelope.data;
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

    private extractRateLimit(envelope: SportmonksResponseEnvelope<unknown> | undefined) {
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
}

/**
 * Raw HTTP-level error from the SportMonks client. Handler-triggered
 * callers wrap this in `ServiceError(502)`; the background fixture poller
 * logs + counts and continues.
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

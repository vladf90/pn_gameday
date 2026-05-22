/**
 * Spins up an Express app, mounts `/metrics` through the real `NoAuthRouter`
 * (so the test exercises the actual BaseRouter pipeline — logging, error
 * handling, `RawResponse` dispatch), and curls it back through Node's
 * built-in fetch. Substitutes for the full `pnpm dev:backend` boot when
 * Postgres / JWT keys aren't available.
 *
 * Usage (from repo root):
 *   pnpm --filter backend exec ts-node scripts/metrics-endpoint-smoke.ts
 */
import * as express from "express";
import {MetricsController} from "../src/controller/MetricsController";
import {NoAuthRouter} from "../src/router/NoAuthRouter";
import {RateLimitTracker, SportmonksHttpClient} from "../src/sportmonks";

async function main() {
    // Drive one stubbed call so SportMonks-specific metrics have non-zero values.
    const tracker = new RateLimitTracker();
    const stubbedFetch: typeof fetch = async () =>
        new Response(
            JSON.stringify({
                data: [{id: 1}],
                rate_limit: {remaining: 1500, requested_entity: "Fixture", resets_in_seconds: 600},
            }),
            {status: 200, headers: {"content-type": "application/json"}},
        );
    const client = new SportmonksHttpClient(
        {apiToken: "stub", baseUrl: "https://example.invalid", fetchImpl: stubbedFetch},
        tracker,
    );
    await client.get("/fixtures/multi/10,20", undefined, {entity: "Fixture"});

    const app = express();
    const router = new NoAuthRouter(app);
    const metricsController = new MetricsController();
    router.get("/metrics", metricsController.handle);

    const port = 20099;
    const server = app.listen(port);

    try {
        const res = await fetch(`http://127.0.0.1:${port}/metrics`);
        const text = await res.text();
        const contentType = res.headers.get("content-type") ?? "";
        const contentDisposition = res.headers.get("content-disposition");

        // eslint-disable-next-line no-console
        console.log(`HTTP ${res.status} (${contentType})`);
        // eslint-disable-next-line no-console
        console.log(`Content-Disposition: ${contentDisposition === null ? "<absent>" : contentDisposition}`);

        const checks = [
            ["HTTP 200", res.status === 200],
            ["Content-Type starts with text/plain", contentType.startsWith("text/plain")],
            ["Content-Type advertises Prometheus version=0.0.4", contentType.includes("version=0.0.4")],
            ["Content-Disposition is NOT set (Prometheus scrapers don't want one)", contentDisposition === null],
            [
                "body contains sportmonks_api_calls_total",
                text.includes("sportmonks_api_calls_total"),
            ],
            [
                "body contains sportmonks_rate_limit_remaining",
                text.includes("sportmonks_rate_limit_remaining"),
            ],
            [
                "body contains nodejs_eventloop_lag_seconds (default metrics)",
                text.includes("nodejs_eventloop_lag_seconds"),
            ],
            [
                "body is NOT wrapped in JSON envelope (no leading {\"data\":)",
                !text.trimStart().startsWith("{\"data\""),
            ],
        ] as const;

        let allOk = true;
        for (const [label, ok] of checks) {
            // eslint-disable-next-line no-console
            console.log(`[${ok ? "ok" : "FAIL"}] ${label}`);
            if (!ok) {
                allOk = false;
            }
        }

        if (!allOk) {
            process.exit(1);
        }
    } finally {
        server.close();
    }
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});

/**
 * Smoke-tests the post-refactor `/metrics` wiring without bringing up the
 * full app (Postgres / JWT keys are not available in this sandbox).
 *
 * Strategy: replicate the exact route-registration sequence from
 * `Bootstrap.setup()` for `/metrics` — `new NoAuthRouter(app); router.get(...)`
 * — and confirm the route resolves through the BaseRouter pipeline.
 *
 * Usage (from repo root):
 *   pnpm --filter backend exec ts-node scripts/bootstrap-import-smoke.ts
 */
import * as express from "express";
import {MetricsController} from "../src/controller/MetricsController";
import {NoAuthRouter} from "../src/router/NoAuthRouter";

async function main() {
    // Confirm the Bootstrap module imports cleanly — this exercises the full
    // import graph (UserController, MetricsController, BaseRouter, RawResponse,
    // NoAuthRouter, etc.) without requiring env vars or DB connectivity.
    const bootstrapModule = await import("../src/Bootstrap");
    if (typeof bootstrapModule.Bootstrap !== "function") {
        // eslint-disable-next-line no-console
        console.error("[FAIL] Bootstrap class not exported");
        process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log("[ok] Bootstrap module imports cleanly");

    // Now replicate the metrics-route registration in isolation.
    const app = express();
    const router = new NoAuthRouter(app);
    const metricsController = new MetricsController();
    router.get("/metrics", metricsController.handle);

    const port = 20100;
    const server = app.listen(port);
    try {
        const res = await fetch(`http://127.0.0.1:${port}/metrics`);
        const ok = res.status === 200;
        // eslint-disable-next-line no-console
        console.log(`[${ok ? "ok" : "FAIL"}] /metrics registered on NoAuthRouter responds 200 (got ${res.status})`);
        if (!ok) {
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

/**
 * Manual smoke script for the Prometheus metrics module. Constructs the
 * dedicated registry, drives a fake SportMonks call through the client with a
 * stubbed `fetchImpl` (same pattern as the SportMonks smoke script in PR #10),
 * and dumps the rendered registry to stdout.
 *
 * Why this exists: spinning up the full Bootstrap requires Postgres + JWT keys.
 * Issue #5's verification step lets us substitute a standalone script when
 * those aren't available — this script asserts the metric *names* (and a
 * couple of values) the issue calls out.
 *
 * Usage (from repo root):
 *   pnpm --filter backend exec ts-node scripts/metrics-smoke.ts
 */
import {RateLimitTracker, SportmonksHttpClient, register} from "../src/sportmonks";

const REQUIRED_METRIC_NAMES = [
    "sportmonks_api_calls_total",
    "sportmonks_api_call_duration_seconds",
    "sportmonks_rate_limit_remaining",
    "sportmonks_rate_limit_reset_seconds",
    "sportmonks_rate_limit_throttled_total",
    "sportmonks_live_fixtures_in_memory",
    "sportmonks_active_fixture_ids",
    "sportmonks_poller_last_success_timestamp",
];

async function main() {
    const tracker = new RateLimitTracker();

    // Stub `fetch` that simulates a successful SportMonks `/fixtures/multi`
    // response with a `rate_limit` block reporting 1995 remaining for the
    // `Fixture` entity.
    const stubbedFetch: typeof fetch = async () => {
        return new Response(
            JSON.stringify({
                data: [{id: 1, name: "Stub Fixture"}],
                rate_limit: {
                    remaining: 1995,
                    requested_entity: "Fixture",
                    resets_in_seconds: 3600,
                },
            }),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    };

    const client = new SportmonksHttpClient(
        {
            apiToken: "stub-token-not-used",
            baseUrl: "https://example.invalid",
            fetchImpl: stubbedFetch,
        },
        tracker,
    );

    await client.get("/fixtures/multi/1,2,3", undefined, {entity: "Fixture"});

    const body = await register.metrics();

    // eslint-disable-next-line no-console
    console.log("--- registry.metrics() output (head) ---");
    // eslint-disable-next-line no-console
    console.log(body.split("\n").slice(0, 60).join("\n"));
    // eslint-disable-next-line no-console
    console.log("--- end head ---");

    let allPresent = true;
    for (const name of REQUIRED_METRIC_NAMES) {
        const present = body.includes(`# TYPE ${name} `) || body.includes(`# HELP ${name} `);
        // eslint-disable-next-line no-console
        console.log(`[${present ? "ok" : "FAIL"}] ${name}`);
        if (!present) {
            allPresent = false;
        }
    }

    // Spot-check that the success counter incremented and the gauge reflects
    // the stubbed `rate_limit.remaining` value.
    const successLineRe = /sportmonks_api_calls_total\{[^}]*status="success"[^}]*\}\s+(\d+(?:\.\d+)?)/;
    const successMatch = body.match(successLineRe);
    const successValue = successMatch ? Number(successMatch[1]) : NaN;
    // eslint-disable-next-line no-console
    console.log(
        `[${successValue === 1 ? "ok" : "FAIL"}] sportmonks_api_calls_total{status="success"} == 1 (got ${successValue})`,
    );

    const remainingLineRe = /sportmonks_rate_limit_remaining\{entity="Fixture"\}\s+(\d+(?:\.\d+)?)/;
    const remainingMatch = body.match(remainingLineRe);
    const remainingValue = remainingMatch ? Number(remainingMatch[1]) : NaN;
    // eslint-disable-next-line no-console
    console.log(
        `[${remainingValue === 1995 ? "ok" : "FAIL"}] sportmonks_rate_limit_remaining{entity="Fixture"} == 1995 (got ${remainingValue})`,
    );

    // Verify endpoint label has IDs stripped.
    const endpointRe = /sportmonks_api_calls_total\{[^}]*endpoint="(\/fixtures\/multi)"/;
    const endpointMatch = body.match(endpointRe);
    // eslint-disable-next-line no-console
    console.log(
        `[${endpointMatch ? "ok" : "FAIL"}] endpoint label collapsed to "/fixtures/multi" (no IDs)`,
    );

    if (!allPresent || successValue !== 1 || remainingValue !== 1995 || !endpointMatch) {
        process.exit(1);
    }
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});

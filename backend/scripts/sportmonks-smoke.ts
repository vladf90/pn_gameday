/**
 * Manual smoke script — hits SportMonks `/core/my/usage` and prints the
 * unwrapped data plus the parsed rate-limit block. Useful for verifying a
 * token works end-to-end before any other code paths come online.
 *
 * Usage (from repo root):
 *   SPORTMONKS_API_TOKEN=... pnpm --filter backend exec ts-node scripts/sportmonks-smoke.ts
 *
 * Not wired into CI — this is a one-off operational tool.
 */
import * as dotenv from "dotenv";
dotenv.config({path: "../.env"});
dotenv.config({path: ".env"});

import {RateLimitTracker, SportmonksClient} from "../src/sportmonks";

async function main() {
    const token = process.env.SPORTMONKS_API_TOKEN;
    if (!token) {
        // eslint-disable-next-line no-console
        console.error("Set SPORTMONKS_API_TOKEN before running this script.");
        process.exit(1);
    }

    const tracker = new RateLimitTracker();
    const client = new SportmonksClient(
        {
            apiToken: token,
            baseUrl: process.env.SPORTMONKS_BASE_URL ?? "https://api.sportmonks.com/v3/football",
        },
        tracker,
    );

    // `/core/my/usage` lives at the `/core` root, not `/football` — pass an
    // absolute override via baseUrl if your token is on a sport other than football.
    const result = await client.get<unknown>("/core/my/usage", undefined, {entity: "usage"});
    // eslint-disable-next-line no-console
    console.log("data:", JSON.stringify(result.data, null, 2));
    // eslint-disable-next-line no-console
    console.log("rate_limit:", result.rateLimit);
    // eslint-disable-next-line no-console
    console.log("tracker.getAll():", tracker.getAll());
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});

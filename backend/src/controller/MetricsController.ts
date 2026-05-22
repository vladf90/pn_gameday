import {Request, Response} from "express";
import {Logger} from "../Logger";
import {ContextFactory} from "../Logger/Context";
import {register} from "../sportmonks/metrics";

/**
 * Exposes the Prometheus registry over HTTP. Kept separate from the JSON-
 * envelope flow in `BaseRouter` because the Prometheus exposition format is
 * a plain-text protocol with its own content-type — wrapping it in `{data, code}`
 * would make the endpoint unscrapable.
 *
 * Auth note: this endpoint is intentionally unauthenticated so a Prometheus
 * scraper can poll it without managing credentials. In production it must be
 * protected at the network layer (reverse proxy / firewall / private subnet).
 */
export class MetricsController {

    private readonly logger = new Logger("MetricsController");

    handle = async (_req: Request, res: Response): Promise<void> => {
        const ctx = ContextFactory.createRequestContext("/metrics", "metrics", "GET");
        try {
            const body = await register.metrics();
            res.setHeader("Content-Type", register.contentType);
            res.status(200).send(body);
        } catch (e) {
            this.logger.error(ctx, "Failed to render Prometheus metrics", {
                error: e instanceof Error ? e.message : String(e),
            });
            res.status(500).send("Failed to render metrics");
        }
    };
}

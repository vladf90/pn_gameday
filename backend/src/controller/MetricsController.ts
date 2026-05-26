import {Logger} from "../Logger";
import {RawResponse} from "../router/BaseRouter";
import {ServiceError} from "../utils/ServiceError";
import * as HttpStatusCodes from "http-status-codes";
import {register} from "../sportmonks/metrics";

/**
 * Exposes the Prometheus registry over HTTP. Returns a `RawResponse` so
 * `BaseRouter` short-circuits the `{data, code}` JSON envelope — the
 * Prometheus exposition format is a plain-text protocol with its own
 * content-type, which a scraper parses directly.
 *
 * Auth note: this endpoint is intentionally unauthenticated (registered on
 * `NoAuthRouter`) so a Prometheus scraper can poll it without managing
 * credentials. In production it must be protected at the network layer
 * (reverse proxy / firewall / private subnet).
 */
export class MetricsController {

    private readonly logger = new Logger("MetricsController");

    handle = async (_auth: void): Promise<RawResponse> => {
        try {
            const body = await register.metrics();
            return {
                body,
                contentType: register.contentType,
            };
        } catch (e) {
            this.logger.error("Failed to render Prometheus metrics", {
                error: e instanceof Error ? e.message : String(e),
            });
            throw ServiceError.build("Failed to render metrics", HttpStatusCodes.INTERNAL_SERVER_ERROR);
        }
    };
}

import * as winston from 'winston';

/**
 * Structured-fields object for a single log event. Free-form by design —
 * callers add whatever keys help debugging. A few keys get special rendering
 * in the log line (ADR 0007); the line shape is:
 *
 *   `[logTag] timestamp level [direction] [statusCode] [method path/url][: message]`
 *
 * Rendered fields:
 *   - `direction`  — `"inbound"` or `"outbound"`. Inbound is set by
 *                    `BaseRouter`, outbound by `SportmonksHttpClient`.
 *   - `statusCode` — HTTP status. Set on both inbound (by `BaseRouter`)
 *                    and outbound (by `SportmonksHttpClient`).
 *   - `method` + `path` — inbound HTTP details.
 *   - `method` + `url`  — outbound HTTP details.
 *
 * Every other field is still attached to the winston `info` and can be
 * picked up by JSON transports.
 */
export type LogFields = Record<string, unknown>;

export class Logger {
    private logger: winston.Logger;
    private logTag: string;

    constructor(logTag: string) {
        this.logger = winston.createLogger({
            levels: winston.config.syslog.levels,
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
                        winston.format.colorize(),
                        winston.format.printf((info) => {
                            const tag = `[${info.logTag}]`;
                            const direction = typeof info.direction === "string" ? ` ${info.direction}` : "";
                            const status = info.statusCode != null ? ` ${info.statusCode}` : "";
                            const httpDetails = formatHttpDetails(info);
                            const stack = info.stack != null ? `\n${info.stack}` : "";
                            const message = info.message !== "" ? `: ${info.message}` : "";
                            return `${info.timestamp} ${tag} ${info.level}${direction}${status}${httpDetails}${message}${stack}`;
                        })
                    )
                })
            ]
        });
        this.logTag = logTag;
    }

    info(message: string, fields?: LogFields) {
        this.log('info', message, fields);
    }

    warning(message: string, fields?: LogFields) {
        this.log('warning', message, fields);
    }

    error(message: string, fields?: LogFields) {
        this.log('error', message, fields);
    }

    exception(e: Error) {
        this.logger.log({
            level: 'crit',
            logTag: this.logTag,
            message: String(e),
            stack: e.stack,
        });
    }

    private log(level: string, message: string, fields: LogFields = {}) {
        this.logger.log({
            level,
            logTag: this.logTag,
            message,
            ...fields,
        });
    }
}

function formatHttpDetails(info: Record<string, unknown>): string {
    const method = typeof info.method === "string" ? info.method : undefined;
    const path = typeof info.path === "string" ? info.path : undefined;
    const url = typeof info.url === "string" ? info.url : undefined;
    if (method && path) {
        return ` ${method} ${path}`;
    }
    if (method && url) {
        return ` ${method} ${url}`;
    }
    return "";
}

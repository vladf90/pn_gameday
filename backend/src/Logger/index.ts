import * as winston from 'winston';

/**
 * Structured-fields object for a single log event. Free-form by design —
 * callers add whatever keys help debugging. A few keys get special rendering
 * in the log line (ADR 0007):
 *
 *   - `statusCode` — printed between level and HTTP details when present.
 *   - `method` + `path`  — inbound HTTP details, rendered as `METHOD path`.
 *   - `method` + `url`   — outbound HTTP details, rendered as `METHOD url`.
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
                            const status = info.statusCode != null ? ` ${info.statusCode}` : "";
                            const httpDetails = formatHttpDetails(info);
                            const stack = info.stack != null ? `\n${info.stack}` : "";
                            const message = info.message !== "" ? `: ${info.message}` : "";
                            return `${info.timestamp} ${info.level}${status} ${httpDetails}[${info.logTag}]${message}${stack}`;
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
        return `${method} ${path} `;
    }
    if (method && url) {
        return `${method} ${url} `;
    }
    return "";
}

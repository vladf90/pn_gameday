import * as winston from 'winston';
import {Context} from "./Context";

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
                            const context = info.context as Context | null | undefined;
                            let httpDetails = "";
                            if (context != null) {
                                httpDetails = context.format();
                            }
                            const stack = info.stack != null ? `\n${info.stack}` : "";
                            const message = info.message !== "" ? `: ${info.message}` : "";
                            return `${info.timestamp} ${info.level} ${info.statusCode} ${httpDetails}[${info.logTag}]${message}${stack}`
                        })
                    )
                })
            ]
        });
        this.logTag = logTag;
    }

    info(ctx: Context, message: string, info?: LogInfo) {
        this.log('info', ctx, message, info);
    }

    warning(ctx: Context, message: string, info?: LogInfo) {
        this.log('warning', ctx, message, info);
    }

    error(ctx: Context, message: string, info?: LogInfo) {
        this.log('error', ctx, message, info);
    }

    exception(e: Error) {
        this.logger.log({
            level: 'crit',
            logTag: this.logTag,
            message: String(e),
            stack: e.stack
        })
    }

    private log(logLevel: string, ctx: Context, message: string, info: LogInfo = {}) {
        this.logger.log({
            logTag: this.logTag,
            message: message,
            level: logLevel,
            context: ctx,
            ...info
        });
    }
}

interface LogInfo {
    [key: string]: unknown;
}

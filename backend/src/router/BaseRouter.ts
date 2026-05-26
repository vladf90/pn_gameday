import {IRouter} from "./IRouter";
import {Application, Request, Response} from "express";
import {Context, InboundRequestContext} from "../Logger/Context";
import {ServiceError} from "../utils/ServiceError";
import {Validator} from "../validator/Validator";
import {Logger} from "../Logger";
import * as cors from "cors";
import { hasPermission } from "../config/permissions";
import * as HttpStatus from 'http-status-codes';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

type Permission = { resource: string; action: string };

type RequestHandler<AuthType, RequestType, ResponseType> =
    (ctx: Context, authType: AuthType, request: RequestType) => Promise<ResponseType>;

type RequestParser = (req: Request) => Record<string, unknown>;

export abstract class BaseRouter<AuthType extends IPermission | void> implements IRouter<AuthType> {
    private logger = new Logger("Router");

    constructor(readonly app: Application) {
    }

    abstract authenticate(request: Request): Promise<AuthType>;

    public get<RequestType, ResponseType>(path: string, requestHandler: RequestHandler<AuthType, RequestType, ResponseType>, validator?: Validator<RequestType>, permission?: Permission): void {
        this.register('get', path, requestHandler, BaseRouter.parseQuery, validator, permission);
    }

    public post<RequestType, ResponseType>(path: string, requestHandler: RequestHandler<AuthType, RequestType, ResponseType>, validator?: Validator<RequestType>, permission?: Permission): void {
        this.register('post', path, requestHandler, BaseRouter.parseBody, validator, permission);
    }

    public patch<RequestType, ResponseType>(path: string, requestHandler: RequestHandler<AuthType, RequestType, ResponseType>, validator?: Validator<RequestType>, permission?: Permission): void {
        this.register('patch', path, requestHandler, BaseRouter.parseBody, validator, permission);
    }

    public delete<RequestType, ResponseType>(path: string, requestHandler: RequestHandler<AuthType, RequestType, ResponseType>, validator?: Validator<RequestType>, permission?: Permission): void {
        this.register('delete', path, requestHandler, BaseRouter.parseBody, validator, permission);
    }

    /**
     * Register a Server-Sent Events route (ADR 0006). Unlike `get`/`post`/etc.,
     * the handler is given the raw Express `req`/`res` because SSE responses
     * are streamed (`text/event-stream`, no `{data, code}` envelope, no
     * `Content-Length`). The router takes care of:
     *   - authentication and permission checks (same flow as the other verbs);
     *   - setting the SSE response headers and flushing them so the client
     *     receives an open stream before the handler writes its first frame.
     *
     * After header flush, the handler owns the connection lifecycle: it must
     * write frames in `data: <json>\n\n` form, install `req.on('close', ...)`
     * cleanup, and call `res.end()` when the stream is meant to close.
     *
     * Errors thrown before headers are flushed are routed through the standard
     * JSON error handler (so callers see a proper 4xx/5xx). Errors after that
     * point can't be reported to the client mid-stream — they're logged and
     * the socket is closed.
     */
    public sse(
        path: string,
        handler: (ctx: Context, auth: AuthType, req: Request, res: Response) => void | Promise<void>,
        permission?: Permission,
    ): void {
        this.app.get(path, cors(), async (req: Request, res: Response) => {
            const ctx = new InboundRequestContext("GET", path);
            try {
                const auth = await this.authenticate(req);
                if (permission) {
                    this.checkPermission(auth, permission.resource, permission.action);
                }

                // SSE response framing — see RFC EventSource for header
                // requirements. `X-Accel-Buffering: no` opts out of nginx
                // buffering so frames reach the client immediately.
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');
                res.flushHeaders();

                this.logger.info(ctx, "", {statusCode: 200});
                await handler(ctx, auth, req, res);
            } catch (e) {
                if (!res.headersSent) {
                    this.handleError(ctx, res, e);
                } else {
                    // Headers already sent — we can't send a JSON error. Log
                    // and close the stream so the client sees a clean EOF
                    // rather than a hung connection.
                    const message = e instanceof Error ? e.message : String(e);
                    this.logger.error(ctx, `SSE handler error after headers sent: ${message}`, {});
                    try {
                        res.end();
                    } catch {
                        // best-effort — socket may already be torn down.
                    }
                }
            }
        });
    }

    private register<RequestType, ResponseType>(
        method: HttpMethod,
        path: string,
        requestHandler: RequestHandler<AuthType, RequestType, ResponseType>,
        parseRequest: RequestParser,
        validator?: Validator<RequestType>,
        permission?: Permission,
    ): void {
        this.app[method](path, cors(), async (req: Request, res: Response) => {
            const ctx = new InboundRequestContext(method.toUpperCase(), path);
            try {
                const auth = await this.authenticate(req);

                if (permission) {
                    this.checkPermission(auth, permission.resource, permission.action);
                }

                const request = parseRequest(req) as RequestType;

                if (validator != null) {
                    const errors = validator.validate(request);
                    if (errors != null) {
                        throw ServiceError.build("Validation Error", 400, {errors: errors});
                    }
                }

                const response = await requestHandler(ctx, auth, request);
                this.logger.info(ctx, "", {statusCode: 200});
                this.sendResponse(res, response);
            } catch (e) {
                this.handleError(ctx, res, e);
            }
        });
    }

    private static parseQuery: RequestParser = (req) => {
        const request: Record<string, unknown> = {};
        for (const key in req.query) {
            request[key] = req.query[key];
        }
        for (const key in req.params) {
            request[key] = req.params[key];
        }
        return request;
    };

    private static parseBody: RequestParser = (req) => {
        const request: Record<string, unknown> = {};
        for (const key in req.body) {
            request[key] = req.body[key];
        }
        for (const key in req.files) {
            request[key] = req.files[key];
        }
        for (const key in req.params) {
            const value = req.params[key];
            request[key] = !isNaN(Number(value)) ? parseInt(value) : value;
        }
        return request;
    };

    private checkPermission(auth: AuthType, resource: string, action: string): void {
        if (!auth || !auth.permissions) {
            throw ServiceError.build("Unauthorized", HttpStatus.UNAUTHORIZED);
        }

        if (!hasPermission(auth.permissions, resource, action)) {
            throw ServiceError.build(
                `Forbidden: Insufficient permissions to ${action} ${resource}`,
                HttpStatus.FORBIDDEN
            );
        }
    }

    private sendResponse<ResponseType>(res: Response, response: ResponseType): void {
        if (this.isRawResponse(response)) {
            this.handleRawResponse(res, response);
        } else if (this.isFileResponse(response)) {
            this.handleFileResponse(res, response);
        } else if (this.isBufferResponse(response)) {
            this.handleBufferResponse(res, response);
        } else {
            res.send(this.encapsulateResponse(response, 200));
        }
    }

    private handleError(ctx: Context, res: Response, e: unknown): void {
        if (e instanceof ServiceError) {
            this.logger.error(ctx, e.message, {statusCode: e.getStatusCode()});
            res.status(e.getStatusCode()).send({
                message: e.message,
                code: e.getStatusCode(),
                data: e.getInfo()
            });
            return;
        }
        throw e;
    }

    private encapsulateResponse<ResponseType>(response: ResponseType, code: number, message?: string): ResponseObject<ResponseType> {
        return {
            data: response,
            code,
            message
        };
    }

    private isRawResponse(response: unknown): response is RawResponse {
        return response !== null &&
               typeof response === 'object' &&
               'body' in response &&
               'contentType' in response &&
               !('filename' in response) &&
               (typeof (response as RawResponse).body === 'string' ||
                (response as RawResponse).body instanceof Buffer) &&
               typeof (response as RawResponse).contentType === 'string';
    }

    private isFileResponse(response: unknown): response is FileResponse {
        return response !== null &&
               typeof response === 'object' &&
               'buffer' in response &&
               'filename' in response &&
               'contentType' in response &&
               (response as FileResponse).buffer instanceof Buffer &&
               typeof (response as FileResponse).filename === 'string' &&
               typeof (response as FileResponse).contentType === 'string';
    }

    private isBufferResponse(response: unknown): response is Buffer {
        return response instanceof Buffer;
    }

    private handleRawResponse(res: Response, raw: RawResponse): void {
        res.setHeader('Content-Type', raw.contentType);
        res.send(raw.body);
    }

    private handleFileResponse(res: Response, fileResponse: FileResponse): void {
        res.setHeader('Content-Type', fileResponse.contentType);
        res.setHeader('Content-Length', fileResponse.buffer.length);

        const disposition = fileResponse.disposition || 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename="${fileResponse.filename}"`);

        res.send(fileResponse.buffer);
    }

    private handleBufferResponse(res: Response, buffer: Buffer, filename?: string): void {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', buffer.length);

        if (filename) {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }

        res.send(buffer);
    }
}

interface IPermission {
    permissions: string[];
}

interface ResponseObject<T> {
    data: T;
    message?: string;
    code: number;
}

export interface FileResponse {
    buffer: Buffer;
    filename: string;
    contentType: string;
    disposition?: 'inline' | 'attachment';
}

/**
 * Plain-body response that bypasses the `{data, code}` JSON envelope while
 * still flowing through `BaseRouter` (logging, error handling, etc.).
 *
 * Use this when the response payload follows a non-JSON wire format that a
 * consumer parses directly — e.g. the Prometheus text exposition format on
 * `/metrics`. Unlike `FileResponse`, no `Content-Disposition` header is set,
 * so the body is rendered inline rather than offered as a download.
 */
export interface RawResponse {
    body: string | Buffer;
    contentType: string;
}

export class FileResponseHelper {
    static createPDF(buffer: Buffer, filename: string, disposition: 'inline' | 'attachment' = 'attachment'): FileResponse {
        return {
            buffer,
            filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
            contentType: 'application/pdf',
            disposition
        };
    }

    static createExcel(buffer: Buffer, filename: string, disposition: 'inline' | 'attachment' = 'attachment'): FileResponse {
        return {
            buffer,
            filename: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            disposition
        };
    }

    static createCSV(buffer: Buffer, filename: string, disposition: 'inline' | 'attachment' = 'attachment'): FileResponse {
        return {
            buffer,
            filename: filename.endsWith('.csv') ? filename : `${filename}.csv`,
            contentType: 'text/csv',
            disposition
        };
    }

    static create(buffer: Buffer, filename: string, contentType: string, disposition: 'inline' | 'attachment' = 'attachment'): FileResponse {
        return {
            buffer,
            filename,
            contentType,
            disposition
        };
    }
}

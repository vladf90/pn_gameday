/**
 * Logging context — stable identity of the unit of work that is emitting
 * log lines. Three kinds (ADR 0007):
 *
 *   - `InboundRequestContext`  — built by the router for incoming HTTP.
 *   - `OutboundRequestContext` — built by HTTP clients for calls we make.
 *   - `JobContext`             — built by background workers / bootstrap.
 *
 * Per-event data (status codes, duration, error details) is NOT on the
 * context; it goes in the `info` object of each `Logger` call.
 */

export class InboundRequestContext {
    constructor(
        public readonly method: string,
        public readonly path: string,
        public readonly timestamp: Date = new Date(),
    ) {}

    format(): string {
        return `${this.method} ${this.path} `;
    }
}

export class OutboundRequestContext {
    constructor(
        public readonly method: string,
        public readonly url: string,
        public readonly startedAt: Date = new Date(),
    ) {}

    format(): string {
        return `${this.method} ${this.url} `;
    }
}

export class JobContext {
    format(): string {
        return "";
    }
}

export type Context = InboundRequestContext | OutboundRequestContext | JobContext;

# 0007 — Logging context refactor: inbound, outbound, job

Status: Accepted
Date: 2026-05-26

## Context

The current logging context system in `backend/src/Logger/Context.ts` has two
shapes: `ProcessContext` (no extra fields) and `RequestContext` (method, path,
service, timestamp). Three things are wrong with it today:

1. **Outbound HTTP is mis-tagged as a "process".** `SportmonksHttpClient.get()`
   falls back to `ContextFactory.createProcessContext("sportmonks")` when no
   caller context is passed. The log line then has no method/path information
   for the outbound call, even though the client knows both. Operators reading
   logs can't tell which SportMonks endpoint was being hit, and can't visually
   separate "request my server received" from "request my server made".

2. **Inbound requests use a placeholder `service`.** `BaseRouter` constructs
   request contexts with `service: "dummy"` because the field is unused in the
   final log output anyway (the printf format string never references
   `context.service`). It's dead data.

3. **No clean home for non-HTTP background work.** `FixturePoller`,
   `SessionAutoCloser`, and the `boot()` / `configureSportmonks()` paths all
   call `createProcessContext("…-name…")`, even though most of those names
   duplicate the logger's `logTag`. Conceptually these are *jobs*, not
   "processes", and the name doesn't need to live on the context at all.

The user-visible symptom that triggered this refactor:

> *"I want clear logs about which requests are inbound and which are
> outbound. Also make sure path and method are displayed. For example
> SportMonkHttpClient should not have a processContext."*

## Decision

Replace the two-kind `ProcessContext | RequestContext` union with a
three-kind discriminated union:

- **`InboundRequestContext`** — created by `BaseRouter` for every inbound
  HTTP request (including SSE). Carries `method`, `path`, `timestamp`.
- **`OutboundRequestContext`** — created by HTTP clients (today:
  `SportmonksHttpClient`) for every outbound call. Carries `method`, `url`,
  `startedAt`.
- **`JobContext`** — created by background workers and the app bootstrap.
  Carries no HTTP-specific fields; exists so the logger signature
  (`info(ctx, ...)`) stays uniform across handlers, clients, and jobs.

All three contexts render method+path (or method+url) where applicable —
that data drives the existing `httpDetails` slot in the log format. Direction
is implied by the logger's `logTag` (which is already in the log line as
`[<tag>]`): `[Router]` is inbound, `[SportmonksHttpClient]` is outbound,
`[FixturePoller]` is a job. We don't introduce a separate `IN`/`OUT` marker.

Drop the `service` field from all contexts. It's unused in the log output and
the inbound code path was filling it with a placeholder anyway. The logger's
`logTag` already names the component.

`SportmonksHttpClient.get()` no longer accepts a `ctx` option and no longer
falls back to a process context. It builds its own `OutboundRequestContext`
from the outbound method + URL on each call.

### Rejected alternatives

- **Direction flag on a single `RequestContext`** — type-narrowing is weaker
  and the inbound/outbound shapes diverge in subtle ways (path vs URL,
  request timestamp vs call-start timestamp), so two types document intent
  better.
- **Auto-wrapping the caller's ctx into a child outbound ctx** — would
  require threading the caller's ctx through HTTP clients only to discard
  most of it. Cleaner to let the client own its outbound ctx end-to-end.
- **Keeping `ProcessContext`'s `service` field** — currently dead data;
  duplicates the `logTag` the `Logger` already takes in its constructor.

## Technical approach

### Affected files

- `backend/src/Logger/Context.ts` — rewrite. Three context classes,
  `format()` on each; export only what callers need (no more
  `ContextFactory` singleton).
- `backend/src/Logger/index.ts` — `Logger` methods still take a context;
  no signature change. The `httpDetails` line in the printf format keeps
  working because every context provides a `format()` method.
- `backend/src/router/BaseRouter.ts` — build `InboundRequestContext` in
  both the `register()` and `sse()` paths. Drop the `"dummy"` service.
- `backend/src/sportmonks/clients/SportmonksHttpClient.ts` — remove the
  `ctx?` option from `GetOptions`; build `OutboundRequestContext` from
  the request method + URL inside `get()`. Update the JSDoc.
- `backend/src/sportmonks/FixturePoller.ts` — `JobContext`.
- `backend/src/sportmonks/SessionAutoCloser.ts` — `JobContext`.
- `backend/src/Bootstrap.ts` — `JobContext` (was `createProcessContext`).
- `backend/src/index.ts` — `JobContext`.

### Public shape

```ts
export class InboundRequestContext {
    constructor(
        public readonly method: string,
        public readonly path: string,
        public readonly timestamp: Date = new Date(),
    ) {}
    format(): string { return `${this.method} ${this.path} `; }
}

export class OutboundRequestContext {
    constructor(
        public readonly method: string,
        public readonly url: string,
        public readonly startedAt: Date = new Date(),
    ) {}
    format(): string { return `${this.method} ${this.url} `; }
}

export class JobContext {
    format(): string { return ""; }
}

export type Context = InboundRequestContext | OutboundRequestContext | JobContext;
```

`Logger.info(ctx, message, info)` etc. continue to accept the union type;
the printf formatter calls `ctx.format()` exactly as before.

### Migration cost

Single PR. Touches ~8 files. No external API changes (HTTP responses
unchanged; log lines change slightly — now outbound calls show their
URL, and the `"dummy"` placeholder is gone). No tests need to assert on
log content today, so the visible blast radius is just `git grep` for the
old factory names.

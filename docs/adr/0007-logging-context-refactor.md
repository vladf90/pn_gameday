# 0007 — Remove logging context, standardize log fields

Status: Accepted
Date: 2026-05-26

## Context

The codebase has a `Logger/Context.ts` module with a `ProcessContext | RequestContext` discriminated union and a `ContextFactory`. Three things are wrong with it:

1. **Outbound HTTP is mis-tagged.** `SportmonksHttpClient.get()` falls back to `ContextFactory.createProcessContext("sportmonks")` when no caller context is passed. The log line then has no method/path information for the outbound call, even though the client knows both.

2. **Inbound requests use a placeholder `service`.** `BaseRouter` constructs request contexts with `service: "dummy"` because the field is unused in the final log output (the printf format never references `context.service`).

3. **`Context` overpromises.** The name evokes Go-style request propagation, OpenTelemetry spans, cancellation, baggage — none of which this codebase has or needs. In practice the object is a log-line decoration: it carries `method` and `path` so the formatter can prefix log lines. Every controller handler accepts a `ctx: Context` first parameter that 90% of them ignore (`_ctx: Context`).

This is a Node monolith. Distributed-tracing apparatus is overkill; if we ever need it, we'll install OpenTelemetry rather than grow a custom context system.

## Decision

**Delete `Logger/Context.ts` entirely.** Drop the `Context` parameter from every `Logger` method and from every controller handler signature. Log consistency becomes a convention enforced by where log calls live (`BaseRouter` for inbound, `SportmonksHttpClient` for outbound), not a type-system contract.

`Logger.info(message, fields?)` accepts a flat structured-fields object. When that object contains `method` and `path` (inbound) or `method` and `url` (outbound), the Winston format string renders them inline so the log line visually starts with the HTTP details — which is the user-visible behavior the previous design was trying to provide.

### Rejected alternatives

- **Keep `Context` and split into `Inbound | Outbound | Job`** — a previous draft of this ADR. Cleans up the mis-tagging but keeps the ceremony: every handler still takes a `ctx` parameter, every entity client still threads it through. The simpler honest answer is that we don't need a context type at all.
- **Adopt OpenTelemetry now** — too heavy for current needs. Revisit if/when we have more than one service or want distributed traces.

## Technical approach

### Logger signature

```ts
class Logger {
    constructor(logTag: string)
    info(message: string, fields?: Record<string, unknown>): void
    warning(message: string, fields?: Record<string, unknown>): void
    error(message: string, fields?: Record<string, unknown>): void
    exception(e: Error): void
}
```

### Log line shape

```
<timestamp> [<logTag>] <level> [<direction>] [<statusCode>] [<method path-or-url>][: <message>]
```

Bracketed segments are optional — rendered only when the relevant fields
are present in the `fields` argument.

Examples:

| Case | Line |
|---|---|
| Inbound success | `2026-05-26 12:00:00 [Router] info inbound 200 POST /sessions/42` |
| Inbound error | `2026-05-26 12:00:00 [Router] error inbound 404 GET /sessions/999: Session not found` |
| Outbound success | `2026-05-26 12:00:00 [SportmonksHttpClient] info outbound 200 GET https://api.sportmonks.com/...` |
| Outbound error | `2026-05-26 12:00:00 [SportmonksHttpClient] error outbound 502 GET https://...: call failed` |
| Job / lifecycle | `2026-05-26 12:00:00 [FixturePoller] info: FixturePoller started` |

Success log lines (inbound and outbound) end cleanly at method+path/url
with an empty message. Errors carry a descriptive message after the
colon. Job lines have no HTTP fields and just print the message.

### Special-cased field names

The formatter picks up these keys for inline rendering:

- `direction` — `"inbound"` (set by `BaseRouter`) or `"outbound"` (set by `SportmonksHttpClient`).
- `statusCode` — HTTP status code. Set on both directions.
- `method` + `path` — inbound HTTP details.
- `method` + `url`  — outbound HTTP details.

Every other field stays attached to the structured log event and is
visible to JSON transports.

### Handler signature

```ts
// before
(ctx: Context, auth: UserAuth, request: T) => Promise<R>
// after
(auth: UserAuth, request: T) => Promise<R>
```

`BaseRouter` no longer passes `ctx` to handlers; it logs the inbound request line itself with `{method, path, statusCode}` fields. The SSE handler signature loses its `ctx` parameter too.

### Convention for log fields

By convention (not enforced by types):
- **Inbound** log lines (from `BaseRouter`) include `method`, `path`, `statusCode`.
- **Outbound HTTP** log lines (from `SportmonksHttpClient`) include `method`, `url`, `status`, `duration_ms`.
- **Job / lifecycle** log lines (from pollers, bootstrap) include whatever structured fields they want; no HTTP fields.

### Affected files

- `backend/src/Logger/Context.ts` — **deleted**.
- `backend/src/Logger/index.ts` — rewrite. New signature, new format function.
- `backend/src/router/IRouter.ts` — drop `Context` from handler type.
- `backend/src/router/BaseRouter.ts` — drop ctx threading; log `{method, path, statusCode}` inline.
- `backend/src/controller/*.ts` — every handler drops its first `_ctx: Context` / `ctx: Context` parameter.
- `backend/src/sportmonks/clients/SportmonksHttpClient.ts` — log with `{method, url, ...}` fields.
- `backend/src/sportmonks/clients/{Fixtures,Leagues,Livescores,Players,Seasons,Standings,Statistics,Teams,Topscorers}Client.ts` — drop `ctx?: Context` from each `<Entity>QueryOptions`.
- `backend/src/sportmonks/FixturePoller.ts`, `backend/src/sportmonks/SessionAutoCloser.ts` — drop ctx variables; call `logger.info("msg", {…})` directly.
- `backend/src/Bootstrap.ts` — drop ctx, change `boot(ctx, config)` to `boot(config)`.
- `backend/src/index.ts` — drop ctx, call `bootstrap.boot(config)`.

### Migration cost

Single PR, ~15 files, mostly mechanical. No external API changes. Log lines change visibly: outbound now shows the full URL, the `"dummy"` placeholder is gone, and absent `statusCode` no longer prints the literal `undefined`.

### Out of scope

- `requestId` / correlation ids. If concurrent-request log correlation becomes a debugging pain point, that's a follow-up — add a `requestId` to the `fields` object at `BaseRouter` and propagate it. Tracked separately if needed.
- OpenTelemetry adoption. Not pursued; if and when we go distributed, OTel replaces this design wholesale.

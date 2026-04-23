# Observability

## What gets logged

The HTTP transport emits a single-line JSON record per request to **stderr**.
Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `ts` | string (ISO-8601) | Server-side timestamp |
| `event` | string | `http_request` for the per-request line; `stdio_ready`, `stdio_shutdown`, etc. for transport lifecycle |
| `status` | number | HTTP status returned to the client |
| `duration_ms` | number | Wall-clock duration |
| `mcp_method` | string? | JSON-RPC method extracted from the body (`tools/list`, `tools/call`, …) |
| `tool` | string? | Tool name when `mcp_method === "tools/call"` |
| `mcp_protocol_version` | string? | `MCP-Protocol-Version` request header |
| `client_user_agent` | string? | `User-Agent` request header |
| `meertrack_request_id` | string? | Upstream `X-Request-Id` from the Meertrack API response. Use this to correlate against backend logs |

The stdio transport emits the same line shape on lifecycle events
(`stdio_ready`, `stdio_shutdown`). It deliberately does **not** log per-request
JSON-RPC frames: stdio sessions are long-lived and the volume isn't useful in
ops, while the same information is already visible to the connected client.

## Redaction

Every log line is passed through `redactApiKeys` before write. Any
`mt_live_…` token is replaced with `mt_live_***`, regardless of which field
it appears in. This applies to:

- The `Authorization` header value (never logged directly, but redacted as a
  defence-in-depth measure if it ever appears in an error message).
- The `?api_key=` query string (same).
- Free-form `message` fields and any custom field added by future log call sites.

If you add a new logged field that may contain a key, you don't need to
remember to redact; the post-serialization redaction pass covers it.

## Where to read logs

V1: rely on `fly logs -a meertrack-mcp` and `fly logs -a meertrack-mcp -f` for
live tailing. Reasoning:

- Launch traffic is bursty and small. Until we cross ~10k requests/day a
  managed sink is overkill.
- The structured single-line JSON shape means once we *do* ship to a sink
  (Axiom, Datadog, Loki, …) it's a config change, not a code change.

Revisit when **either**:
- daily volume exceeds 10k requests, or
- we need to retain logs longer than Fly's default retention (a few days), or
- we need cross-service correlation with the Meertrack backend logs.

When that happens, the natural pick is whichever sink the main Meertrack
backend is using. Co-locating logs simplifies cross-referencing
`meertrack_request_id` between the two surfaces.

## Cross-referencing with the Meertrack backend

Each upstream API call returns an `X-Request-Id` header. The HTTP transport
captures it via `MeertrackClient.onUpstreamResponse` and folds it into the
per-request log line as `meertrack_request_id`. To debug a customer report:

1. Find the MCP-side log line (by `tool`, time, or status).
2. Take the `meertrack_request_id` value.
3. Search the Meertrack backend logs for the matching request.

If the backend ever stops emitting `X-Request-Id`, the field will simply be
absent; no log lines are dropped.

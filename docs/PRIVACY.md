# Privacy

## TL;DR

The MCP layer is a **stateless proxy**. It holds no customer data at rest,
persists no bearer tokens, and writes no request bodies to disk. Bearers
travel through to `api.meertrack.com/v1` on a per-request basis and are
redacted from every log line.

For data-at-rest handling (competitor profiles, digests, activity history),
the authoritative policy is the main Meertrack privacy policy at
[meertrack.com/privacy](https://meertrack.com/privacy).

## What the MCP layer stores

**Nothing.** There is no database, no cache, no queue backed by this service.

- **Bearer tokens**: forwarded per request to upstream, never written to
  disk, never logged. The value of the `Authorization` header and the
  `?api_key=` query parameter are both excluded from logs by construction,
  and a belt-and-braces post-serialization pass redacts any `mt_live_…`
  substring that slips into a log field regardless of origin.
- **Request bodies**: the JSON-RPC frame is parsed once in memory to extract
  the tool name and method for logging; the full body is not written to any
  sink.
- **Response bodies**: streamed straight back to the client. Not cached, not
  copied to an external analytics pipeline.

## What the MCP layer logs

A single-line JSON record per HTTP request is written to **stderr** (shipped
to Fly.io's log ring). Fields:

- `ts`, `status`, `duration_ms`
- `mcp_method` (e.g. `tools/call`), `tool` (e.g. `list_activities`)
- `mcp_protocol_version`, `client_user_agent`
- `meertrack_request_id`: the upstream `X-Request-Id`, for correlating with
  Meertrack backend logs when debugging a customer report

**Not logged**: the `Authorization` header, any `?api_key=` value, request
bodies, response bodies, tool inputs, tool outputs.

The stdio transport emits a subset (lifecycle events only) since per-request
JSON-RPC frames are already visible to the connected client.

See [OBSERVABILITY.md](OBSERVABILITY.md) for the exact log shape and
redaction rules.

## Third parties

- **Fly.io** hosts the remote transport. Fly sees inbound TLS traffic, log
  lines, and metrics. They do not see bearer tokens (redacted) or request
  bodies (not logged).
- **npm** distributes the local transport. `npm install -g @meertrack/mcp`
  or `npx -y @meertrack/mcp` downloads the package from npm; it then
  connects directly from the customer's machine to `api.meertrack.com`
  without traversing Meertrack infrastructure.
- **No analytics / telemetry**. The MCP server does not phone home.

## Data-in-transit

- Customer → hosted MCP: HTTPS, `force_https = true` in Fly config; no
  HTTP listener.
- Hosted MCP → upstream API: HTTPS (`https://api.meertrack.com/v1`).
- Local MCP → upstream API: HTTPS.

## Data-at-rest

Nothing is written at rest by the MCP layer. All persistent data (competitor
profiles, digests, activity rows) lives in the Meertrack main product and
is subject to the [main privacy policy](https://meertrack.com/privacy).

## Questions

Reach out to `security@meertrack.com` for privacy or security questions
about the MCP wrapper specifically, or `privacy@meertrack.com` for questions
about the main product's data handling.

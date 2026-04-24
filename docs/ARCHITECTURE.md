# Architecture

`@meertrack/mcp` is a thin, stateless MCP wrapper around the public Meertrack
v1 REST API. No database, no queue, no caching layer: the MCP layer resolves
a bearer, dispatches to a tool, calls upstream, and maps the response.

## Request flow

```
 ┌────────────────────┐         ┌───────────────────────────────┐         ┌──────────────────────────┐
 │                    │         │     meertrack-mcp             │         │                          │
 │  MCP client        │         │ ┌───────────────────────────┐ │         │  api.meertrack.com/v1    │
 │  (Claude Desktop,  │         │ │ transport                 │ │         │                          │
 │   Cursor, …)       │         │ │  • stdio  (local)         │ │         │  8 GET endpoints         │
 │                    │ ──(1)──▶│ │  • streamable-http (Fly)  │ │ ──(4)──▶│  Bearer mt_live_…        │
 │                    │         │ └─────────────┬─────────────┘ │         │  60 req/min per key      │
 │                    │         │               │               │         │                          │
 │                    │         │ ┌─────────────▼─────────────┐ │         │                          │
 │                    │         │ │ auth: resolve bearer      │ │         │                          │
 │                    │         │ │  (env var | Authorization │ │         │                          │
 │                    │         │ │   header | ?api_key= fb.) │ │         │                          │
 │                    │         │ └─────────────┬─────────────┘ │         │                          │
 │                    │         │               │               │         │                          │
 │                    │         │ ┌─────────────▼─────────────┐ │         │                          │
 │                    │         │ │ McpServer                 │ │         │                          │
 │                    │         │ │  • 8 tools                │ │         │                          │
 │                    │         │ │  • 3 prompts              │ │         │                          │
 │                    │         │ └─────────────┬─────────────┘ │         │                          │
 │                    │         │               │               │         │                          │
 │                    │         │ ┌─────────────▼─────────────┐ │         │                          │
 │                    │         │ │ MeertrackClient           │ │         │                          │
 │                    │         │ │  • fetch + typed errors   │ │         │                          │
 │                    │         │ │  • X-Request-Id capture   │ │         │                          │
 │                    │         │ └─────────────┬─────────────┘ │         │                          │
 │                    │         │               │               │         │                          │
 │                    │◀──(6)───│ ◀──(5)── error → tool-error   │ ◀──(4)──│                          │
 │                    │         │         map (isError: true)   │         │                          │
 └────────────────────┘         └───────────────────────────────┘         └──────────────────────────┘
                                          ↑    (2) (3)
                                          │
                                   logs (stderr): single-line JSON per request,
                                   mt_live_*** redacted
```

Numbered flow:

1. **Client → MCP**. The MCP client (Claude Desktop, Cursor, …) sends a
   JSON-RPC `tools/call` frame over the chosen transport.
2. **Bearer resolution.** In stdio mode, the bearer was captured once from
   `MEERTRACK_API_KEY` at process start. In HTTP mode, it's pulled per
   request from `Authorization` (preferred) or `?api_key=` (fallback).
   The HTTP transport accepts two bearer shapes:
   - **Static API keys** (`mt_live_…`): forwarded verbatim to upstream.
   - **OAuth 2.1 access tokens** (JWTs): verified locally against the
     authorization server's JWKS via `jose` (RS256, `iss=https://meertrack.com`,
     `aud=https://mcp.meertrack.com/mcp`). The original JWT is forwarded to
     upstream so `/api/v1/*` handlers can authorize the same way.
   Requests with no or malformed credentials return 401 + `WWW-Authenticate:
   Bearer realm="meertrack", resource_metadata=<PRM URL>` per RFC 9728,
   without calling upstream.
3. **Tool dispatch.** `McpServer` routes to the named tool, validates the
   zod input schema, and hands off to the handler.
4. **Upstream call.** `MeertrackClient` issues a single `GET` to
   `api.meertrack.com/v1`, with `Authorization: Bearer mt_live_…` and a
   `meertrack-mcp/<version>` User-Agent. No retries; 429s are surfaced.
5. **Error mapping.** Non-2xx responses are translated into MCP **tool
   errors** (`{ content, isError: true }`) per spec §server/tools. 401, 403,
   404, 429, and 5xx each get a tailored user-facing message. JSON-RPC
   protocol errors are reserved for genuinely malformed MCP calls (unknown
   tool, bad params).
6. **Response.** Valid responses come back as
   `{ content: [...], structuredContent: { ... }, isError: false }`. The
   `structuredContent` conforms to the tool's declared `outputSchema`.

## Why per-request `McpServer` in HTTP mode

Each `POST /mcp` builds a fresh `McpServer` bound to that request's bearer,
then tears it down when the response is flushed. This:

- isolates per-key auth state, with no risk of a long-lived server leaking
  one workspace's state into another's request
- makes the hosted tier genuinely stateless (Fly.io can auto-stop machines
  safely; no in-memory session cache to warm)

If profiling ever shows `McpServer` construction is a hot spot, the fix is to
hoist *tool registration* to module scope (tool definitions are static) and
only rebuild the per-request auth/client binding. Do **not** share a mutable
server across requests with different bearers. Not a v1 optimization.

## What's not in the hot path

- **No database.** The MCP layer persists nothing; bearers aren't stored
  (see [PRIVACY.md](PRIVACY.md)).
- **No cache.** Every tool call results in at most one upstream REST request.
  Caching would need to be per-bearer, which at v1 traffic isn't worth it.
- **No retries.** 429 and 5xx are surfaced to the agent; the agent decides
  whether to back off and retry.
- **No authorization server in this repo.** The MCP server is a pure
  OAuth 2.1 **resource server**. The authorization server (DCR, authorize,
  token, revoke, consent UI) lives in the `meertrack_frontend` repo at
  `https://meertrack.com`. The PRM endpoint advertises it via
  `authorization_servers: ["https://meertrack.com"]` when the
  `MEERTRACK_OAUTH_*` env vars are set; when unset, PRM returns
  `authorization_servers: []` and only `mt_live_` keys are accepted.

## Deployment

- **Local**: `npx -y @meertrack/mcp` on Node ≥ 20. Stdio transport, key via
  env.
- **Hosted**: Fly.io app `meertrack-mcp` in the region nearest the upstream
  API. Public URL `https://mcp.meertrack.com/mcp`. Auto-stops when idle;
  `min_machines_running = 1` keeps one warm for launch traffic. Health check
  on `GET /health`.

## OAuth 2.1 resource-server behavior

When the three `MEERTRACK_OAUTH_*` env vars are set (`ISSUER`, `AUDIENCE`,
`JWKS_URL`), the HTTP transport:

- Advertises the AS in the PRM document (`authorization_servers`).
- 302-redirects `GET /.well-known/oauth-authorization-server` to the issuer's
  real metadata URL. Some MCP clients probe the RS for AS metadata before (or
  instead of) consulting the PRM's `authorization_servers` pointer; the
  redirect keeps them on the happy path.
- Accepts JWTs alongside `mt_live_` keys. JWT verification uses `jose` with
  a cached remote JWKS (`createRemoteJWKSet`), checks `iss`, `aud`, `exp`,
  `iat`, and forwards the original JWT to upstream.
- Always permits loopback HTTP origins (`http://localhost:*`,
  `http://127.0.0.1:*`) through the origin allowlist. Bearer-auth endpoint
  with no cookie state → DNS-rebinding / cookie-theft isn't the threat
  model, and MCP dev tools (Inspector, Claude Desktop) register from
  loopback origins with user-chosen ports.

Disabling OAuth is an env-only operation (`fly secrets unset …`); no code
change or redeploy needed. `mt_live_` keys keep working through the same
code path.

## Spec deviations (documented)

- **Stateless only.** No `Mcp-Session-Id` issued; `GET /mcp` and `DELETE
  /mcp` return 405 with `Allow: POST`. Spec-compliant for servers that
  don't push notifications.

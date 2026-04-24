# Changelog

All notable changes to `@meertrack/mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Tool schemas are part of the public API contract; agents cache them. So:

- **MAJOR**: a tool is removed, or an existing tool's input/output schema
  breaks (a required arg added, a field renamed, an enum value removed).
- **MINOR**: a new tool, a new optional argument, or a new prompt.
- **PATCH**: bug fixes, description improvements, internal refactors with
  no schema impact.

## [Unreleased]

## [1.1.0] - 2026-04-24

### Added

- **OAuth 2.1 resource-server support.** HTTP transport now accepts JWT
  access tokens issued by `https://meertrack.com` in addition to legacy
  `mt_live_` keys. JWT verification uses `jose` with a cached remote JWKS;
  PRM advertises the AS via `authorization_servers` when the
  `MEERTRACK_OAUTH_ISSUER` / `MEERTRACK_OAUTH_AUDIENCE` /
  `MEERTRACK_OAUTH_JWKS_URL` env vars are set. Opt-in: with no env vars,
  behavior is unchanged. Rollback is env-only (`fly secrets unset …`).
- `GET /.well-known/oauth-authorization-server` on the RS now 302-redirects
  to the issuer's metadata URL when OAuth is configured. Works around MCP
  clients that probe the RS for AS metadata instead of following PRM's
  `authorization_servers` pointer.

### Changed

- Origin allowlist always permits loopback HTTP (`http://localhost:*`,
  `http://127.0.0.1:*`). The HTTP endpoint authenticates via Bearer tokens
  (no cookies), so DNS-rebinding / cross-site cookie theft isn't the threat
  model, and MCP dev tools (Inspector, Claude Desktop) connect from
  loopback with user-chosen ports.
- `whoami` output: `data.key` is now nullable. OAuth-authenticated users
  have no `mt_live_` key record, so upstream returns `key: null` and the
  schema no longer requires a non-null key object.

### Fixed

- `list_competitors` `expand=compact` no longer returns validation errors.
  `image_icon`, `created_at`, `social`, `pages` on `CompetitorDetail` are
  now optional (compact responses omit them).
- Dropped strict `.url()` validation on all URL-shaped output fields.
  Upstream returns blank strings (`""`) for unset social / page URLs,
  which are valid JSON but failed `z.string().url()`.
- `key_points` on `blog-posts`, `press-posts`, `case-studies` is now
  `string | null` (was `array<string> | null`). Upstream stores
  `key_points` as free-form text (`s_blog_posts.key_points text`), so the
  previous array schema rejected every non-null response.
- `pricing_data` on `pricing` items now accepts both object and array
  shapes. The scraper emits either depending on the competitor; the
  object-only schema rejected array-shaped payloads.

## [1.0.2] - 2026-04-23

### Fixed

- `.github/workflows/publish.yml`: upgrade npm before publishing. Node 20
  ships with npm 10.x, which does not exchange a GitHub Actions OIDC token
  for an npm bearer when a Trusted Publisher is configured — it only signs
  provenance. That left the publish `PUT` unauthenticated and npm returned
  a 404 for the scoped package. npm 11.5.1+ performs the token exchange
  automatically; we now install the latest npm in CI before `npm ci`.

### Note

- 1.0.1 was tagged but never reached npm due to the CI bug above. 1.0.2
  is the first registry-ready release.

## [1.0.1] - 2026-04-23

### Changed

- `server.json`: migrate packages[] to 2025-12-11 schema field names
  (`registryType`, `identifier`, `runtimeHint`, `environmentVariables`) and
  add the now-required `transport: { type: "stdio" }` block. No behavior
  change for clients; required for MCP Registry publishing.
- `package.json`: add `mcpName: "com.meertrack/mcp-server"` so the registry
  can verify npm package ownership against the server entry.
- `scripts/check-version-sync.mjs`: check `registryType`/`identifier` and
  assert `package.json` `mcpName` equals `server.json` `name`.

## [1.0.0] - 2026-04-23

### Added

- Initial release.
- 8 read-only tools wrapping the Meertrack v1 API: `whoami`,
  `list_competitors`, `get_competitor`, `list_activities`, `get_activity_item`,
  `list_digests`, `list_latest_digests`, `get_digest`.
- 3 prompt workflows: `weekly_recap`, `competitor_deep_dive`, `whats_new`.
- stdio transport (local, via `npx -y @meertrack/mcp`).
- Streamable HTTP transport (hosted at `https://mcp.meertrack.com/mcp`).
- Per-request bearer forwarding with `mt_live_` prefix validation.
- `WWW-Authenticate` + RFC 9728 Protected Resource Metadata stub on 401s.
- Origin allowlist (DNS rebinding protection) on the HTTP transport.
- Single-line JSON request logs with bearer redaction.

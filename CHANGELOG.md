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

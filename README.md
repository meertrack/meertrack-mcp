# `@meertrack/mcp`

[![MCP protocol 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-5e5edd)](https://modelcontextprotocol.io/specification/2025-11-25)
[![8 tools · 3 prompts](https://img.shields.io/badge/tools-8%20%C2%B7%20prompts%203-10b981)](#the-8-tools)
[![npm](https://img.shields.io/npm/v/@meertrack/mcp.svg)](https://www.npmjs.com/package/@meertrack/mcp)
[![CI](https://github.com/meertrack/meertrack-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/meertrack/meertrack-mcp/actions/workflows/ci.yml)

Model Context Protocol server for [Meertrack](https://meertrack.com). Ask your
agent "what did my competitors ship this week?" from Claude, Cursor, Claude
Code, VS Code, Windsurf, Cline, ChatGPT, or anywhere that speaks MCP.

Wraps the [Meertrack v1 REST API](https://api.meertrack.com/v1) as **8
read-only tools** and **3 prompt workflows**. No backend changes, same
`mt_live_` keys, same rate limits.

---

## Pick your transport

| | Local (stdio) | Remote (Streamable HTTP) |
| --- | --- | --- |
| **Setup time** | 30 seconds (paste a JSON block) | 10 seconds (paste a URL) |
| **Best for** | Individual Pro customers; all Claude Desktop plans; any IDE on your laptop | Team/Enterprise custom connectors; Claude.ai web; remote-capable IDEs |
| **Runs where** | Your machine (`npx -y @meertrack/mcp`) | Meertrack's Fly.io fleet (`https://mcp.meertrack.com/mcp`) |
| **Auth** | `MEERTRACK_API_KEY` env var | OAuth 2.1 (browser flow, recommended) or `Authorization: Bearer mt_live_…` header |
| **Plan gating** | Works on Claude Pro, Team, Enterprise | Claude Desktop "Add custom connector" is **Team/Enterprise only** |

**If you're on Claude Pro, use the local (stdio) path.** The "Add custom
connector" button in the Claude Desktop settings is gated to Team/Enterprise,
and pasting `https://mcp.meertrack.com/mcp` there won't do anything on a Pro
plan.

## Get an API key

Mint a production key at **Settings → API Keys** in the Meertrack app. Keys
start with `mt_live_`. Only production keys work; there is no `mt_test_`
flavour.

> **Rate limits.** Each API key shares a **60 requests/minute** budget enforced
> upstream. If you run the MCP from multiple clients at once (Claude Desktop +
> Cursor + a background agent) they all draw from the same bucket. Mint a
> separate key per workstation or per agent to isolate budgets. The tool-error
> message on 429 includes both a human-readable reset time and the raw
> `X-RateLimit-Reset` epoch so the agent can back off automatically.

---

## Local install: recommended default

All local-mode clients use the same shape: `npx -y @meertrack/mcp` with
`MEERTRACK_API_KEY` in the environment. What differs is the config file and
the surrounding JSON key.

Drop-in copies of every config file below live in [`examples/`](examples/).

### Claude Desktop (all plans)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "meertrack": {
      "command": "npx",
      "args": ["-y", "@meertrack/mcp"],
      "env": {
        "MEERTRACK_API_KEY": "mt_live_..."
      }
    }
  }
}
```

> **Gotcha**: Claude Desktop only re-reads this file on launch. Fully quit
> (⌘Q on macOS) and reopen. Reloading the window is not enough.

### Cursor

Edit `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "meertrack": {
      "command": "npx",
      "args": ["-y", "@meertrack/mcp"],
      "env": {
        "MEERTRACK_API_KEY": "mt_live_..."
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add meertrack npx -y @meertrack/mcp \
  --env MEERTRACK_API_KEY=mt_live_...
```

### VS Code (GitHub Copilot MCP)

Edit `.vscode/mcp.json` (per-workspace) or the user settings equivalent:

```json
{
  "servers": {
    "meertrack": {
      "command": "npx",
      "args": ["-y", "@meertrack/mcp"],
      "env": {
        "MEERTRACK_API_KEY": "mt_live_..."
      }
    }
  }
}
```

> **Gotcha**: VS Code uses `servers`, not `mcpServers`. The Copilot MCP picker
> won't find your server if you use the Claude Desktop key.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "meertrack": {
      "command": "npx",
      "args": ["-y", "@meertrack/mcp"],
      "env": {
        "MEERTRACK_API_KEY": "mt_live_..."
      }
    }
  }
}
```

> **Gotcha**: Windsurf's remote-connector shape uses `serverUrl`, not `url`.
> For the stdio config above, the shape is identical to Claude Desktop.

### Cline (VS Code extension)

Cline's settings panel → "MCP Servers" → paste:

```json
{
  "mcpServers": {
    "meertrack": {
      "command": "npx",
      "args": ["-y", "@meertrack/mcp"],
      "env": {
        "MEERTRACK_API_KEY": "mt_live_..."
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

---

## Remote install: Team/Enterprise + claude.ai web

All remote clients point at the same URL:

```
https://mcp.meertrack.com/mcp
```

Two auth paths are supported:

- **OAuth 2.1 (recommended)** — spec-conformant MCP clients discover the
  authorization server at `/.well-known/oauth-protected-resource`, perform
  Dynamic Client Registration at `https://meertrack.com/oauth/register`, and
  drive the full PKCE-gated authorize → token flow. The user clicks
  "Connect", signs in at `meertrack.com`, hits Allow on the consent screen,
  and is done. No key handling. Access tokens are 10-minute JWTs
  (RS256, `aud=https://mcp.meertrack.com/mcp`); refresh tokens are rotated
  per OAuth 2.1 §4.3.1.
- **`Authorization: Bearer mt_live_…`** — paste a static API key for custom
  connectors, CLI scripts, and any client that doesn't implement OAuth
  discovery yet.

Both paths terminate at the same workspace; pick whichever your client
supports.

### Claude Desktop (Team / Enterprise only: "Add custom connector")

Settings → Connectors → **Add custom connector** → paste the URL above.
**Do not paste a bearer token** — leave the token field empty and click Add.
Claude Desktop will open a browser window to `meertrack.com` for login and
consent; on Allow, the connector surfaces the 8 tools automatically.

The "Add custom connector" button is not visible on Pro; use the stdio path
above instead.

### Claude.ai web (Connectors)

Same as above in the web app's Connectors panel.

### Cursor (remote MCP)

```json
{
  "mcpServers": {
    "meertrack": {
      "url": "https://mcp.meertrack.com/mcp",
      "headers": {
        "Authorization": "Bearer mt_live_..."
      }
    }
  }
}
```

### ChatGPT MCP connectors

Paste the URL and bearer in the ChatGPT "Add MCP" dialog. Note: ChatGPT's
bearer support is minimal today; full OAuth parity is tracked as Phase 11.

### n8n / Zapier / …any Streamable HTTP client

- Endpoint: `https://mcp.meertrack.com/mcp`
- Method: `POST`
- Headers: `Authorization: Bearer mt_live_…`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2025-11-25`

---

## The 8 tools

All read-only, all snake_case. Collection returns use the `list_` prefix;
single-item returns use `get_`. Every list response includes
`pagination.next_cursor` and `pagination.has_more`, and agents must pass
`next_cursor` back as `cursor` to fetch the next page.

| Domain | Tool | Wraps | Notes |
| --- | --- | --- | --- |
| Identity | [`whoami`](src/tools/whoami.ts) | `GET /me` | Confirms workspace + subscription + rate-limit snapshot. Call first. |
| Competitors | [`list_competitors`](src/tools/list_competitors.ts) | `GET /competitors` | Defaults to `expand=full` so agents don't round-trip for socials/pages. |
| Competitors | [`get_competitor`](src/tools/get_competitor.ts) | `GET /competitors/{id}` | 11 tracked sections (blog, pricing, jobs, …) with per-section caps. |
| Activity | [`list_activities`](src/tools/list_activities.ts) | `GET /activity` | Core "what shipped" feed. Default `limit=50` to stay under tool-result size limits. |
| Activity | [`get_activity_item`](src/tools/get_activity_item.ts) | `GET /activity/{row_uuid}` | Drill-in for a specific row's full payload. |
| Digests | [`list_digests`](src/tools/list_digests.ts) | `GET /digests` | Cursor-paginated weekly digests. No `total` field (unlike activity). |
| Digests | [`list_latest_digests`](src/tools/list_latest_digests.ts) | `GET /digests/latest` | No params; one-shot "what happened this week". |
| Digests | [`get_digest`](src/tools/get_digest.ts) | `GET /digests/{id}` | Full summary + themes for one competitor × period. |

Full input / output / error-code documentation is on the tool descriptions
themselves, and the MCP client displays them inline.

## The 3 prompts

Slash commands in Claude Desktop / Cursor / Claude Code / any prompt-capable
MCP client. Each one chains tool calls into a complete workflow.

| Prompt | Args | Chains |
| --- | --- | --- |
| [`/weekly_recap`](src/prompts/weekly_recap.ts) | none | `list_latest_digests` → per-competitor summary + highlights |
| [`/competitor_deep_dive`](src/prompts/competitor_deep_dive.ts) | `competitor_name` | `list_competitors` → `get_competitor` → `list_activities` (last 30d) |
| [`/whats_new`](src/prompts/whats_new.ts) | `days?` (default 7) | `list_activities` from `now - N days`, grouped by competitor |

### Example invocations

- `/weekly_recap`
- `/competitor_deep_dive competitor_name="Acme"`
- `/whats_new days="14"`

See [`examples/prompts.md`](examples/prompts.md) for a dozen copy-paste user
prompts grouped by use case (weekly check-in, feature spec research, pricing
comparison, board-deck prep).

---

## Troubleshooting

When the upstream API returns an error, the MCP tool response surfaces the
upstream `code` in the error text. Map them:

| Upstream `code` | What it means | Fix |
| --- | --- | --- |
| `unauthorized` | Key is invalid, revoked, or expired | Mint a new key at Settings → API Keys and update the config |
| `competitor_inactive` | Competitor is archived in this workspace | Reactivate the competitor in the dashboard |
| `forbidden_competitor` | The `id` you passed isn't in this workspace | Call `list_competitors` first to discover valid ids |
| `rate_limited` | 60 req/min cap hit | Wait until the reset timestamp in the error message, or mint a second key for the other client |
| `not_found` | No such row in this workspace | The id is either wrong or belongs to a different workspace |
| `invalid_parameter` / `invalid_cursor` | Bad input | Check the error message; cursors expire, so re-list from the start |

**Other common snags**

- Claude Desktop didn't pick up your config → **quit and relaunch the app**,
  not just close the window. Config is read at launch.
- `command not found: npx` → install Node ≥ 20. The MCP pins `engines.node`.
- Remote URL returns 401 with `WWW-Authenticate: Bearer` → your bearer is
  missing, malformed, or doesn't start with `mt_live_`.
- You see 401s that clear up when you refresh the key → the bearer is fine;
  this is a spec-conformant "please authenticate" from the MCP. Send the
  `Authorization` header.
- Running both stdio and remote with the **same key** → you're sharing a
  60/min budget across both. Mint separate keys per client.

---

## Semantic versioning

MCP tool schemas are part of the public API contract; agents cache them. So:

- **MAJOR**: a tool is removed, or an existing tool's input/output schema
  breaks (required arg added, field renamed, enum value removed).
- **MINOR**: a new tool, a new optional argument, or a new prompt.
- **PATCH**: bug fixes, description improvements, internal refactors with no
  schema impact.

See [CHANGELOG.md](CHANGELOG.md) for the release history, and
[docs/RELEASING.md](docs/RELEASING.md) for the maintainer publish procedure.

## Security & privacy

- **Privacy policy**: [https://meertrack.com/privacy](https://meertrack.com/privacy)
- [SECURITY.md](SECURITY.md): disclosure policy (`security@meertrack.com`),
  in-scope surface.
- [docs/PRIVACY.md](docs/PRIVACY.md): the MCP layer is stateless; bearers are
  forwarded per-request and nothing is persisted.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): request flow diagram.
- [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md): what gets logged, and how
  bearer tokens are redacted.

## License

MIT.

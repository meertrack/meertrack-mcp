# Launch guide

Pre-drafted copy for submitting `@meertrack/mcp` to MCP directories
(modelcontextprotocol.io, glama.ai, mcp.so, Smithery, etc.), Product Hunt,
HN, newsletters, and partner announcements. Copy a block, submit, move on.

---

## Tagline (≤ 80 chars)

> Meertrack MCP: ask Claude what your competitors shipped this week.

## Short (≤ 190 chars)

> Meertrack MCP wraps the Meertrack v1 API for Claude, Cursor, and any MCP
> client. 8 tools + 3 slash commands for weekly digests, activity feeds, and
> competitor deep-dives.

## Medium (≤ 500 chars)

> `@meertrack/mcp` connects Meertrack's competitive-intelligence platform to
> any MCP-aware agent. 8 read-only tools (1:1 with the REST API) and 3 ready-
> made slash commands (`/weekly_recap`, `/competitor_deep_dive`,
> `/whats_new`) cover the "what shipped across my tracked competitors"
> workflow in one click. Ships both as an `npx` stdio package and as a hosted
> Streamable HTTP endpoint at `mcp.meertrack.com`. Bearer auth with the same
> `mt_live_` keys customers already use.

## Long (full pitch)

> **Meertrack** tracks what every company in your competitive set ships each
> week (blog posts, pricing changes, job listings, LinkedIn moves,
> messaging tweaks) and synthesizes a weekly digest per competitor.
>
> **`@meertrack/mcp`** brings that feed into Claude, Cursor, Claude Code, VS
> Code Copilot, Windsurf, Cline, ChatGPT, and anywhere else that speaks the
> Model Context Protocol. Instead of copy-pasting a digest into your chat
> window, just ask: *"What did my tracked competitors ship this week?"* The
> agent calls `list_latest_digests`, summarizes per competitor, and
> highlights the notable moves.
>
> Under the hood it's a thin, stateless wrapper around the public
> [Meertrack v1 REST API](https://api.meertrack.com/v1). Same API keys
> (`mt_live_…`), same 60 req/min rate limits, same workspace scoping.
> Nothing new to authorize. The hosted transport stores no credentials;
> bearers are forwarded per-request and redacted from every log line.
>
> **What's in the box:**
>
> - 8 read-only tools: `whoami`, `list_competitors`, `get_competitor`,
>   `list_activities`, `get_activity_item`, `list_digests`,
>   `list_latest_digests`, `get_digest`
> - 3 prompt workflows: `/weekly_recap`, `/competitor_deep_dive`,
>   `/whats_new`
> - Stdio transport (`npx -y @meertrack/mcp`) for local clients on any plan
> - Streamable HTTP transport (`https://mcp.meertrack.com/mcp`) for
>   Team/Enterprise custom connectors and claude.ai web
> - MCP protocol version `2025-11-25`, RFC 9728 Protected Resource Metadata,
>   DNS-rebinding protection, structured single-line JSON logs with full
>   bearer redaction
> - Free-tier listings live on modelcontextprotocol.io and glama.ai

---

## Target audience

Meertrack paying customers who already use agents in their day-to-day work:

- **Product managers** running weekly competitor check-ins who want a
  natural-language "what's new" instead of scanning a digest UI.
- **Founders & strategy leads** doing monthly or quarterly competitive
  briefs. The `/competitor_deep_dive` slash command produces a structured
  one-pager per competitor in one shot.
- **Sales / BD teams** who need quick answers on competitor pricing,
  positioning, or hiring during deal cycles.
- **Developers / solutions engineers** who want to wire Meertrack data into
  internal agent workflows (n8n, Zapier, custom Claude API scripts) without
  writing HTTP glue.

Not for: prospective / free-tier users. MCP access requires an `mt_live_`
production key.

## Use-case recipes

Each one is a user prompt. Drop it into Claude / Cursor / Claude Code once
the MCP is connected.

1. **Monday-morning recap.** `/weekly_recap` produces one paragraph per
   competitor, plus a cross-competitor highlights list.
2. **Deal-desk pricing check.** *"Pull the current pricing tiers for Acme
   and Globex and put them in a comparison table."*
3. **Hiring-signal dashboard.** *"Which tracked competitors added net-new
   engineering job listings in the last 14 days?"*
4. **Feature-launch post-mortem.** *"Acme shipped a new onboarding flow last
   week. Find the activity row, pull the full payload, and compare to
   what they had before."*
5. **Board-deck prep.** `/whats_new days="90"` gives one slide's worth of
   signal for the next investor update.
6. **Ad-hoc deep-dive.** `/competitor_deep_dive competitor_name="Acme"`
   returns profile plus last-30-day activity in a structured brief.

## Supported clients (smoke-tested at launch)

| Client | Transport | Plan notes |
| --- | --- | --- |
| Claude Desktop | stdio | All plans (Pro / Team / Enterprise) |
| Claude Desktop "Add custom connector" | HTTP | **Team / Enterprise only** |
| Claude.ai web | HTTP | Team / Enterprise connectors |
| Claude Code | stdio or HTTP | `claude mcp add` |
| Cursor | stdio or HTTP | All plans |
| VS Code (Copilot MCP) | stdio | Uses `servers`, not `mcpServers` |
| Windsurf | stdio | Same shape as Claude Desktop |
| Cline | stdio | VS Code extension |
| ChatGPT MCP connectors | HTTP | Bearer support is minimal today; full OAuth is Phase 11 |
| n8n / Zapier / other remote-capable | HTTP | Point at `https://mcp.meertrack.com/mcp` |

## Security & scopes

- **Auth**: static bearer tokens (`mt_live_…`). Scopes on the Meertrack
  backend already constrain the key to read-only, workspace-scoped access;
  the MCP does not elevate.
- **Transport**: HTTPS on the hosted endpoint (`force_https = true` on
  Fly.io). DNS-rebinding protection via `Origin` allowlist.
- **Storage**: none. Bearers are forwarded per request, not persisted, not
  logged.
- **Standards**: MCP 2025-11-25, RFC 9728 Protected Resource Metadata,
  MCP-spec-compliant `WWW-Authenticate` on 401s.
- **Disclosure**: `security@meertrack.com`. See [SECURITY.md](SECURITY.md).

## Links

- Repo: https://github.com/meertrack/meertrack-mcp
- npm: https://www.npmjs.com/package/@meertrack/mcp
- Hosted endpoint: https://mcp.meertrack.com/mcp
- Main product: https://meertrack.com
- MCP spec: https://modelcontextprotocol.io/specification/2025-11-25

## Assets

- Icon: [logo in main product brand kit; request from `hello@meertrack.com`]
- Screenshots: suggested captures for directory submissions.
  1. Claude Desktop running `/weekly_recap` with a multi-competitor
     recap rendered.
  2. Cursor showing the 8 tools list from the MCP picker.
  3. Claude Code terminal output of `whoami` + `list_latest_digests`.

## Boilerplate FAQ

**Is it free?** The MCP is free; it requires a paying Meertrack subscription
(any plan that issues `mt_live_` keys).

**Does it work on Claude Pro?** Yes. Use the local stdio path (`npx -y
@meertrack/mcp`). The remote custom-connector path is Team/Enterprise only.

**Do you store my API key?** No. See [docs/PRIVACY.md](docs/PRIVACY.md).

**Can I run it air-gapped?** Run the stdio package on a machine with
outbound HTTPS to `api.meertrack.com`. There's no offline mode; the data
lives in the SaaS.

**What's the rate limit?** 60 requests/minute per key, enforced upstream.
Mint separate keys per agent/workstation if you're sharing a budget.

**How do I remove it?** Delete the MCP entry from your client config (or
`claude mcp remove meertrack`) and, optionally, revoke the API key at
Settings → API Keys.

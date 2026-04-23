# Security policy: `@meertrack/mcp`

## Reporting a vulnerability

Email **`security@meertrack.com`** with a description of the issue, steps to
reproduce, and any proof-of-concept material. PGP key available on request.

Please do **not** open a public GitHub issue for security reports.

We aim to acknowledge new reports within 2 business days and provide an
initial assessment within 5 business days. High-severity issues get an
out-of-band patch; everything else ships in the next regular release.

## Scope

**In scope**

- The MCP wrapper itself: code in this repository (`meertrack_mcp`),
  the published npm package `@meertrack/mcp`, and the hosted deployment at
  `https://mcp.meertrack.com`.
- Issues with bearer handling, log redaction, origin/DNS-rebinding
  protection, transport conformance, or tool error mapping that could leak
  data across workspaces.

**Out of scope**

- Bugs in the upstream Meertrack API (`api.meertrack.com/v1`). Please
  send those to the main product's disclosure address (also
  `security@meertrack.com`, but tag the report as a main-product issue).
- Third-party MCP clients (Claude Desktop, Cursor, VS Code, and others).
  Report those to their respective vendors.
- Denial-of-service from a single key exceeding the 60/min upstream rate
  limit. That's a rate-limit, not a vulnerability.
- Social-engineering reports, physical security, reports that require an
  already-compromised workstation.

## Supported versions

We ship fixes for the **latest minor** of `@meertrack/mcp`. Upgrade with
`npm install -g @meertrack/mcp@latest` (local) or pull the newest hosted
container (automatic on Fly).

Older minors may receive a security fix if the required backport is small
and the minor is ≤ 90 days old. Otherwise, please upgrade.

## Recognition

We'll credit reporters by name in the relevant [CHANGELOG](../CHANGELOG.md)
entry unless they prefer to stay anonymous. We do not run a paid bounty
program for the MCP wrapper at this time.

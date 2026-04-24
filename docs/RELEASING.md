# Releasing

Procedure for cutting a new version of `@meertrack/mcp` and updating the
`com.meertrack/mcp-server` entry on the MCP Registry. Intended for maintainers.

## What a release touches

A Meertrack release is three artifacts kept in lockstep:

1. **npm** — `@meertrack/mcp` on registry.npmjs.org
2. **MCP Registry** — `com.meertrack/mcp-server` on registry.modelcontextprotocol.io
3. **Git** — tag `vX.Y.Z` on `main`

A successful release means all three advertise the same version number and
point at the same tarball. [scripts/check-version-sync.mjs](../scripts/check-version-sync.mjs)
guards the first two; CI gates the whole publish on it.

## SemVer rules for this project

MCP tool schemas are part of the public API contract — agents cache them. So:

- **MAJOR** — tool removed, or existing tool input/output schema breaks
  (required arg added, field renamed, enum value removed)
- **MINOR** — new tool, new optional argument, or new prompt
- **PATCH** — bug fixes, description tweaks, internal refactors with no
  schema impact

## One-time setup (already done, documented for recovery)

### DNS ownership proof for `com.meertrack/*`

The MCP Registry verifies domain control via a TXT record on the apex of
`meertrack.com`:

```
meertrack.com. IN TXT "v=MCPv1; k=ed25519; p=<PUBLIC_KEY_BASE64>"
```

This record must stay in place — every future `mcp-publisher publish` call
signs its request with the matching Ed25519 private key and the registry
verifies against this TXT. If the record is removed, publishes break.

### Keypair location

The DNS keypair lives at the repo root (gitignored — see
[.gitignore](../.gitignore)):

- `meertrack-dns.key.pem` — Ed25519 private key in PEM
- `dns-privkey.hex` — same key as hex, consumed by `mcp-publisher login dns`

If the keypair is lost, rotate: generate a new one, replace the TXT record
value, re-run `mcp-publisher login dns`. See the "Rotate keypair" section
below for the exact commands.

### npm Trusted Publisher

`@meertrack/mcp` on npmjs.com has a Trusted Publisher record pointing at
`meertrack/meertrack-mcp` → `publish.yml` (no environment). This lets
[.github/workflows/publish.yml](../.github/workflows/publish.yml) publish
with provenance, no npm token required.

## Release procedure

Everything below assumes a clean working tree on `main`.

### 1. Bump the version

Pick `X.Y.Z` per the SemVer rules above. Update in three places:

- [package.json](../package.json) → `version`
- [server.json](../server.json) → `version` (top-level) and `packages[0].version`
- [CHANGELOG.md](../CHANGELOG.md) → add a new `## [X.Y.Z] - YYYY-MM-DD` section
  above the prior release

The `mcpName` / `name` fields stay `com.meertrack/mcp-server` forever —
changing them breaks the registry ↔ npm ownership binding.

### 2. Local gate

```bash
npm run check:version-sync
npm run check:changelog
npm run lint
npm run typecheck
npm test
npm run build
mcp-publisher validate        # hits the registry's live schema validator
```

All seven must pass. CI runs the first six again; `mcp-publisher validate`
only runs locally so catch schema violations here before tagging.

### 3. Commit + tag + push → triggers npm publish

```bash
git add CHANGELOG.md package.json server.json
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

The tag push fires [.github/workflows/publish.yml](../.github/workflows/publish.yml),
which re-runs the gate, then publishes to npm with provenance.
Watch:

```bash
gh run watch --exit-status
```

Confirm the package is live before moving on:

```bash
npm view @meertrack/mcp@X.Y.Z version mcpName
```

Both fields must be populated. If `mcpName` is missing, the registry publish
in step 4 will fail package-verification.

### 4. Publish to the MCP Registry

```bash
mcp-publisher login dns --domain=meertrack.com --private-key="$(cat dns-privkey.hex)"
mcp-publisher publish
```

`publish` reads [server.json](../server.json) from the cwd and verifies that
the npm package at `@meertrack/mcp@X.Y.Z` declares `mcpName:
com.meertrack/mcp-server` — which is why step 3 must complete first.

Verify the entry landed:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=com.meertrack/mcp-server" \
  | jq '.servers[0].server.version, .servers[0]._meta'
```

`version` should read `X.Y.Z`, `isLatest` should be `true`.

## Rotate the DNS keypair

Only needed if the private key is lost or exposed.

```bash
openssl genpkey -algorithm Ed25519 -out meertrack-dns.key.pem
openssl pkey -in meertrack-dns.key.pem -pubout -outform DER | tail -c 32 | base64
openssl pkey -in meertrack-dns.key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n' > dns-privkey.hex
```

Replace the `p=` portion of the TXT record on `meertrack.com` with the new
base64 public key. Wait for DNS to propagate (`dig TXT meertrack.com +short`),
then `mcp-publisher login dns ...` with the new hex key.

## Failure modes we've hit

- **npm `PUT … 404` during publish, with provenance signed.** Workflow's
  npm version is too old for the Trusted Publisher OIDC token exchange (needs
  npm ≥ 11.5.1). Fix: `npm install -g npm@latest` before `npm ci` in the
  workflow. See [CHANGELOG.md entry 1.0.2](../CHANGELOG.md).

- **Registry `422 description too long`.** The registry caps
  `description` at 100 chars. `mcp-publisher validate` catches this.

- **`mcp-publisher publish` rejects with "package verification failed".**
  The npm `@meertrack/mcp@X.Y.Z` is missing `mcpName`, or its value doesn't
  match `server.json.name`. Both must equal `com.meertrack/mcp-server`.

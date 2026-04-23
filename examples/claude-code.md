# Claude Code: `claude mcp add`

Claude Code doesn't read a JSON config file; it stores MCP servers in its
project- or user-scoped state. Use the CLI:

```bash
claude mcp add meertrack npx -y @meertrack/mcp \
  --env MEERTRACK_API_KEY=mt_live_REPLACE_ME
```

Flags:

- `--scope user`: register globally (default is project-scoped).
- `--env KEY=VALUE`: repeatable; sets an environment variable for the
  spawned process.

Verify:

```bash
claude mcp list
```

You should see `meertrack` listed as `running`. In a Claude Code session, try:

```
/mcp meertrack whoami
```

Or just ask: *"What did my tracked competitors ship this week?"* Claude Code
will pick up the `weekly_recap` / `whats_new` prompts automatically.

## Remote (Streamable HTTP): Team/Enterprise

If your plan supports custom connectors, you can point at the hosted server
instead of running `npx` locally:

```bash
claude mcp add-json meertrack '{
  "url": "https://mcp.meertrack.com/mcp",
  "headers": { "Authorization": "Bearer mt_live_REPLACE_ME" }
}'
```

The hosted server stores no credentials; the bearer you send is forwarded
per-request to `api.meertrack.com/v1` and never persisted.

## Removing

```bash
claude mcp remove meertrack
```

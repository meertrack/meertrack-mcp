---
name: Feature request
about: A new tool, prompt, parameter, or capability for the MCP server
title: "[feat] "
labels: enhancement
---

## Use case

<!-- What problem are you trying to solve? Concrete example beats abstract description. -->

## Proposed shape

<!-- If you're requesting a new tool or prompt, sketch the input/output it should have. -->

```ts
// e.g. tool: list_screenshots
// inputs: { competitor_id: string, since?: string }
// returns: { items: [{ id, url, captured_at }], next_cursor? }
```

## Why MCP (not the REST API)

<!-- Why does this need to live in the MCP wrapper rather than be done by the agent calling the existing 8 tools? -->

## Alternatives considered

<!-- Workarounds you've tried, related tools you compose, etc. -->

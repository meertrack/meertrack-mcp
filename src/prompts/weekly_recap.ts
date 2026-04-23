import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WEEKLY_RECAP_NAME = "weekly_recap";

export const WEEKLY_RECAP_DESCRIPTION =
  "One-shot 'what happened across my tracked competitors this week'. Fetches the latest digests and produces a per-competitor recap plus a cross-competitor highlights list.";

export function registerWeeklyRecap(server: McpServer): void {
  server.registerPrompt(
    WEEKLY_RECAP_NAME,
    {
      title: "Weekly recap",
      description: WEEKLY_RECAP_DESCRIPTION,
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Produce a weekly recap of my tracked competitors using the Meertrack MCP server.",
              "",
              "1. Call `list_latest_digests`. This returns one digest per active competitor from the most recent batch day — no parameters needed.",
              "2. For each digest, write a short one-paragraph summary (2-4 sentences) of that competitor's activity. Use the digest's `summary.executive_summary` and `summary.themes` as source material; do not invent details not present in the payload.",
              "3. After all per-competitor paragraphs, add a `## Highlights` section: a 3-6 bullet list of the most notable changes across competitors (new features shipped, pricing changes, big hires, removed offerings).",
              "4. If `list_latest_digests` returns an empty `data` array, say so plainly — do not guess.",
              "",
              "Formatting: Markdown. Headings per competitor (`## {competitor name}`). Keep paragraphs tight; prefer concrete facts (URLs, dates, prices) over generic phrasing.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

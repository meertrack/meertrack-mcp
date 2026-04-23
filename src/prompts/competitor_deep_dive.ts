import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const COMPETITOR_DEEP_DIVE_NAME = "competitor_deep_dive";

export const COMPETITOR_DEEP_DIVE_DESCRIPTION =
  "Full profile and recent-activity brief for one competitor. Resolves the competitor by name, pulls the full profile, and summarizes the last 30 days of detected changes.";

const argsSchema = {
  competitor_name: z
    .string()
    .min(1)
    .describe("Competitor display name or a distinctive substring. Case-insensitive."),
} as const;

export function registerCompetitorDeepDive(server: McpServer): void {
  server.registerPrompt(
    COMPETITOR_DEEP_DIVE_NAME,
    {
      title: "Competitor deep dive",
      description: COMPETITOR_DEEP_DIVE_DESCRIPTION,
      argsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Produce a structured deep-dive brief on the competitor "${args.competitor_name}" using the Meertrack MCP server.`,
              "",
              "Step 1 — Resolve the competitor id:",
              "- Call `list_competitors` (no filters, default `expand=full`).",
              `- Find the row whose \`name\` matches "${args.competitor_name}" (case-insensitive; substring match is acceptable). If no row matches, stop and tell the user — do not guess.`,
              "- If several rows match, list them and ask the user to disambiguate.",
              "",
              "Step 2 — Fetch the full profile:",
              "- Call `get_competitor` with the resolved `id`. This returns the profile plus the most recent items from each tracked section (blog posts, pricing, job listings, messaging, logos, metrics, LinkedIn, YouTube, events, press, case studies).",
              "",
              "Step 3 — Fetch recent activity:",
              "- Call `list_activities` with `competitor_ids=[<id>]` and `from=<today minus 30 days, ISO 8601>`. Default `limit=50` is fine; page once if `pagination.has_more` is true.",
              "",
              "Step 4 — Synthesize the brief with these sections:",
              "- `## Profile` — website, category, social handles from `get_competitor`.",
              "- `## What's new (last 30 days)` — grouped by section; emphasize `change_type=added`.",
              "- `## Current positioning` — draw from `messaging`, `metrics-claimed`, and `pricing` items in the profile.",
              "- `## Hiring signals` — from `job-listings` if present.",
              "",
              "Rules: cite concrete items (URLs, posted dates, prices). Do not invent details not present in the tool responses. If a section has no items, say 'No data' rather than padding.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

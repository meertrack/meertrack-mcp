import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WHATS_NEW_NAME = "whats_new";

export const WHATS_NEW_DESCRIPTION =
  "Cross-competitor 'what's new in the last N days' feed, grouped by competitor, with `added` changes highlighted.";

const argsSchema = {
  // MCP wire format passes prompt args as strings — coerce to int inside the
  // handler instead of declaring z.number(), which would fail validation on
  // a client-sent "7".
  days: z
    .string()
    .optional()
    .describe("Lookback window in days. Default 7. Integer string, e.g. `14`."),
} as const;

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

export function registerWhatsNew(server: McpServer): void {
  server.registerPrompt(
    WHATS_NEW_NAME,
    {
      title: "What's new",
      description: WHATS_NEW_DESCRIPTION,
      argsSchema,
    },
    (args) => {
      const parsed = args.days !== undefined ? Number.parseInt(args.days, 10) : DEFAULT_DAYS;
      const days =
        Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_DAYS ? parsed : DEFAULT_DAYS;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Summarize what every tracked competitor has done in the last ${days} days using the Meertrack MCP server.`,
                "",
                `1. Compute the cutoff: now minus ${days} days, formatted as ISO 8601 (e.g. \`2026-04-16T00:00:00Z\`).`,
                "2. Call `list_activities` with `from=<cutoff>` and the default `limit=50`. If `pagination.has_more` is true, page until exhausted or you have enough material for the summary — cap at ~3 pages.",
                "3. Group the rows by `competitor.name`. Within each competitor, sort by `change_date` descending.",
                "4. For each competitor with at least one change, write `### {name}` followed by a bullet list. Each bullet = `[change_type] section — short one-line description`. Put `[added]` changes first; they matter most.",
                "5. End with a `## Cross-competitor themes` section: 2-4 bullets naming patterns that appear across multiple competitors (shared hiring surge, parallel pricing moves, similar new features, etc.). Only include themes you can point to concrete rows for.",
                "",
                "Rules: do not invent changes that aren't in the `list_activities` response. If a competitor has zero rows in the window, omit them — don't pad.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

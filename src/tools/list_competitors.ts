import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { CompetitorDetailListResponse } from "../types.js";
import { toToolError } from "../errors.js";

export const LIST_COMPETITORS_NAME = "list_competitors";

export const LIST_COMPETITORS_DESCRIPTION = [
  "Wraps `GET /competitors`. Lists every competitor in the authenticated workspace. Defaults to `expand=full` so the agent gets each competitor's social URLs (`linkedin`, `twitter`, …) and canonical page URLs (`pricing`, `blog`, …) in one call — no round-trip to `get_competitor` needed for that metadata.",
  "",
  "Filters:",
  "- `active`: when true, only competitors still being tracked; when false, only archived ones.",
  "- `ids`: narrow to a specific subset (comma-joined upstream).",
  "- `expand`: `full` (default — profile + social + pages) or `compact` (id / name / website / category / active only).",
  "",
  "Chaining: Discover competitor ids here, then pass them to `get_competitor`, `list_activities` (`competitor_ids`), or `list_digests` (`competitor_id`).",
  "Errors: `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  active: z
    .boolean()
    .optional()
    .describe("Filter to active (true) or archived (false) competitors. Omit to return both."),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe("Narrow to this subset of competitor ids. Omit to return all."),
  expand: z
    .enum(["full", "compact"])
    .optional()
    .describe(
      "`full` (default) adds social + pages metadata; `compact` returns id/name/website/category/active only.",
    ),
} as const;

export function registerListCompetitors(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    LIST_COMPETITORS_NAME,
    {
      title: "List competitors",
      description: LIST_COMPETITORS_DESCRIPTION,
      inputSchema,
      outputSchema: CompetitorDetailListResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const expand = args.expand ?? "full";
        const params: {
          active?: boolean;
          ids?: string[];
          expand?: "full";
        } = {};
        if (args.active !== undefined) params.active = args.active;
        if (args.ids && args.ids.length > 0) params.ids = args.ids;
        if (expand === "full") params.expand = "full";
        const data = await client.listCompetitors(params);
        return {
          structuredContent: data,
          content: [{ type: "text", text: JSON.stringify(data) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    },
  );
}

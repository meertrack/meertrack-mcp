import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { CompetitorOverviewResponse, objectId } from "../types.js";
import { toToolError } from "../errors.js";

export const GET_COMPETITOR_NAME = "get_competitor";

export const GET_COMPETITOR_DESCRIPTION = [
  "Wraps `GET /competitors/{id}`. Returns a single competitor's full profile plus the most recent items from each tracked section. Sections returned (with per-section item caps):",
  "- `blog-posts` (up to 20), `press-posts` (20), `case-studies` (20)",
  "- `job-listings` (100), `pricing` (9), `messaging` (100)",
  "- `metrics-claimed` (100), `logos` (100)",
  "- `linkedin-posts` (20), `youtube-videos` (20), `events` (20)",
  "",
  "Chaining: Use after `list_competitors` — pass the `id` from a result row. For an activity timeline across sections, call `list_activities` with `competitor_ids=[id]` instead.",
  "Errors: `not_found` (no such competitor in this workspace), `competitor_inactive` (archived — reactivate in dashboard), `forbidden_competitor` (different workspace), `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  id: objectId("Competitor id from `list_competitors`."),
} as const;

export function registerGetCompetitor(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    GET_COMPETITOR_NAME,
    {
      title: "Get competitor",
      description: GET_COMPETITOR_DESCRIPTION,
      inputSchema,
      outputSchema: CompetitorOverviewResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const data = await client.getCompetitor(args.id);
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

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import {
  ActivityListResponse,
  CHANGE_TYPES,
  SECTION_SLUGS,
  paginationInput,
} from "../types.js";
import { toToolError } from "../errors.js";

export const LIST_ACTIVITIES_NAME = "list_activities";

export const LIST_ACTIVITIES_DESCRIPTION = [
  "Wraps `GET /activity`. Returns a cursor-paginated feed of detected changes across every tracked competitor — the core 'what shipped' surface.",
  "",
  "Filters:",
  `- \`sections\`: restrict to specific section types (enum of ${SECTION_SLUGS.length}: ${SECTION_SLUGS.join(", ")}).`,
  `- \`change_types\`: restrict to \`added\` / \`updated\` / \`removed\` (${CHANGE_TYPES.join(" / ")}).`,
  "- `competitor_ids`: narrow to specific competitors.",
  "- `from` / `to`: ISO 8601 date-time window (inclusive). E.g. `from=2026-04-16T00:00:00Z` for the last 7 days.",
  "",
  "Pagination: response carries `pagination.next_cursor`, `pagination.has_more`, and `pagination.total` (total rows matching the filters across the whole window, not just this page). If `has_more`, call again with the `cursor` param set to `next_cursor` to fetch the next page. **Default `limit` is 50** to stay under Claude's tool-result size limit; max is 500.",
  "",
  "Chaining: Start here for any 'what happened recently' question; use `get_activity_item` to drill into a specific row's full payload.",
  "Errors: `invalid_parameter` (bad section/change_type/date), `invalid_cursor` (stale or tampered), `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  competitor_ids: z
    .array(z.string().uuid())
    .optional()
    .describe("Narrow to these competitor ids. Omit for all tracked competitors."),
  sections: z
    .array(z.enum(SECTION_SLUGS))
    .optional()
    .describe("Filter to specific section types (e.g. `['pricing', 'blog-posts']`)."),
  change_types: z
    .array(z.enum(CHANGE_TYPES))
    .optional()
    .describe("Filter to specific change types. `added` is usually the interesting one."),
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive lower bound, ISO 8601 with offset (e.g. `2026-04-16T00:00:00Z`)."),
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive upper bound, ISO 8601 with offset."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Page size. Default 50 (tool-result size limit); max 500. Prefer smaller pages and paginate.",
    ),
  cursor: paginationInput.cursor,
} as const;

const DEFAULT_LIMIT = 50;

export function registerListActivities(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    LIST_ACTIVITIES_NAME,
    {
      title: "List activities",
      description: LIST_ACTIVITIES_DESCRIPTION,
      inputSchema,
      outputSchema: ActivityListResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const params: Parameters<typeof client.listActivity>[0] = {
          limit: args.limit ?? DEFAULT_LIMIT,
        };
        if (args.competitor_ids && args.competitor_ids.length > 0)
          params.competitor_ids = args.competitor_ids;
        if (args.sections && args.sections.length > 0) params.sections = args.sections;
        if (args.change_types && args.change_types.length > 0)
          params.change_types = args.change_types;
        if (args.from) params.from = args.from;
        if (args.to) params.to = args.to;
        if (args.cursor) params.cursor = args.cursor;
        const data = await client.listActivity(params);
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

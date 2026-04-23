import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { DigestListResponse, paginationInput } from "../types.js";
import { toToolError } from "../errors.js";

export const LIST_DIGESTS_NAME = "list_digests";

export const LIST_DIGESTS_DESCRIPTION = [
  "Wraps `GET /digests`. Returns cursor-paginated weekly digests (one per competitor per batch day) — the LLM-synthesized summaries. Unlike `list_activities`, pagination here has **no `total`**; use `has_more` / `next_cursor` only.",
  "",
  "Filters: `competitor_id` (narrow to one competitor), `from` / `to` (ISO 8601 date-time window on `period_start`).",
  "",
  "Chaining: For 'what happened last week across all competitors', prefer `list_latest_digests` — it's a one-shot. Use this when paging backward through history, or filtering to one competitor.",
  "Errors: `invalid_parameter`, `invalid_cursor`, `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  competitor_id: z
    .string()
    .uuid()
    .optional()
    .describe("Narrow to one competitor's digests. Omit for all tracked competitors."),
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive lower bound on `period_start`, ISO 8601 with offset."),
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Inclusive upper bound on `period_start`, ISO 8601 with offset."),
  limit: paginationInput.limit,
  cursor: paginationInput.cursor,
} as const;

export function registerListDigests(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    LIST_DIGESTS_NAME,
    {
      title: "List digests",
      description: LIST_DIGESTS_DESCRIPTION,
      inputSchema,
      outputSchema: DigestListResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const params: Parameters<typeof client.listDigests>[0] = {};
        if (args.competitor_id) params.competitor_id = [args.competitor_id];
        if (args.from) params.from = args.from;
        if (args.to) params.to = args.to;
        if (args.limit !== undefined) params.limit = args.limit;
        if (args.cursor) params.cursor = args.cursor;
        const data = await client.listDigests(params);
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

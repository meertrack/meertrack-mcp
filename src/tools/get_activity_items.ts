import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { ActivityItemsResponse, objectId } from "../types.js";
import { toToolError } from "../errors.js";

export const GET_ACTIVITY_ITEMS_NAME = "get_activity_items";

export const GET_ACTIVITY_ITEMS_DESCRIPTION = [
  "Wraps `GET /activity/items`. Returns the full payload for one or more activity rows — the section-specific detail (full blog description, key points, pricing table, etc.) that the `list_activities` feed omits to stay lean.",
  "",
  "Pass a list of row `id`s from a `list_activities` result (1–100). Resolving several at once is one call / one rate-limit hit — prefer it over many single lookups.",
  "Partial success is normal: ids that don't resolve (unknown, in another workspace, from an inactive period, or malformed) come back in `not_found`, not as an error. **`data` order is not guaranteed — match results back by `id`.**",
  "Digest ids are NOT activity rows: they land in `not_found`. Use `get_digest` for those.",
  "Errors: `unauthorized`, `rate_limited`, `invalid_parameter` (no ids / too many).",
].join("\n");

const inputSchema = {
  row_uuids: z
    .array(objectId("Activity row `id` from a `list_activities` result."))
    .min(1)
    .max(100)
    .describe("1–100 activity row ids to resolve in one batch."),
} as const;

export function registerGetActivityItems(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    GET_ACTIVITY_ITEMS_NAME,
    {
      title: "Get activity items",
      description: GET_ACTIVITY_ITEMS_DESCRIPTION,
      inputSchema,
      outputSchema: ActivityItemsResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const data = await client.getActivityItems(args.row_uuids);
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

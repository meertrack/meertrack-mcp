import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { ActivityDetailResponse, objectId } from "../types.js";
import { toToolError } from "../errors.js";

export const GET_ACTIVITY_ITEM_NAME = "get_activity_item";

export const GET_ACTIVITY_ITEM_DESCRIPTION = [
  "Wraps `GET /activity/{row_uuid}`. Returns the full payload for a single activity row — the section-specific detail (full blog body, full pricing table, etc.) that the `list_activities` feed only summarizes.",
  "",
  "Chaining: Use after `list_activities` to drill into a row the user has asked about. Pass the row's `id` from the list response.",
  "Errors: `not_found` (row isn't in this workspace), `forbidden_competitor` (the row's competitor is in a different workspace), `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  row_uuid: objectId("Activity row `id` from a `list_activities` result."),
} as const;

export function registerGetActivityItem(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    GET_ACTIVITY_ITEM_NAME,
    {
      title: "Get activity item",
      description: GET_ACTIVITY_ITEM_DESCRIPTION,
      inputSchema,
      outputSchema: ActivityDetailResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const data = await client.getActivityItem(args.row_uuid);
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

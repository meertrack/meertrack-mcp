import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { DigestResponse, objectId } from "../types.js";
import { toToolError } from "../errors.js";

export const GET_DIGEST_NAME = "get_digest";

export const GET_DIGEST_DESCRIPTION = [
  "Wraps `GET /digests/{id}`. Returns a single digest's full payload — executive summary, themes, and update count for one competitor in one period.",
  "",
  "Chaining: Use after `list_digests` or `list_latest_digests` — pass the `id` from a result row.",
  "Errors: `not_found` (digest not in this workspace), `forbidden_competitor`, `unauthorized`, `rate_limited`.",
].join("\n");

const inputSchema = {
  id: objectId("Digest id from a `list_digests` or `list_latest_digests` row."),
} as const;

export function registerGetDigest(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    GET_DIGEST_NAME,
    {
      title: "Get digest",
      description: GET_DIGEST_DESCRIPTION,
      inputSchema,
      outputSchema: DigestResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const data = await client.getDigest(args.id);
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

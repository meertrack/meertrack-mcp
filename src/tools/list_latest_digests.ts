import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { DigestLatestResponse } from "../types.js";
import { toToolError } from "../errors.js";

export const LIST_LATEST_DIGESTS_NAME = "list_latest_digests";

export const LIST_LATEST_DIGESTS_DESCRIPTION = [
  "Wraps `GET /digests/latest`. No parameters. Returns the most recent digest per active competitor from the same batch day — a one-shot 'what happened this week across my tracked competitors'.",
  "",
  "Chaining: One-shot entry point — no prior call needed. If the user wants older weeks or a specific competitor's history, use `list_digests` instead.",
  "Errors: `unauthorized`, `rate_limited`.",
].join("\n");

export function registerListLatestDigests(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    LIST_LATEST_DIGESTS_NAME,
    {
      title: "List latest digests",
      description: LIST_LATEST_DIGESTS_DESCRIPTION,
      inputSchema: {},
      outputSchema: DigestLatestResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const data = await client.listLatestDigests();
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

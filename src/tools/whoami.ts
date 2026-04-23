import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { MeResponse } from "../types.js";
import { toToolError } from "../errors.js";

export const WHOAMI_NAME = "whoami";

export const WHOAMI_DESCRIPTION = [
  "Wraps `GET /me`. Confirms which workspace and API key the agent is authenticated as and returns the current subscription, competitor budget, and rate-limit snapshot.",
  "",
  "Chaining: Call first in a session to verify auth and workspace identity before any other tool.",
  "Errors: `unauthorized` (key is invalid or revoked — mint a new one), `rate_limited` (retry after `X-RateLimit-Reset`).",
].join("\n");

export function registerWhoami(server: McpServer, client: MeertrackClient): void {
  server.registerTool(
    WHOAMI_NAME,
    {
      title: "Who am I?",
      description: WHOAMI_DESCRIPTION,
      inputSchema: {},
      outputSchema: MeResponse.shape,
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const data = await client.me();
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

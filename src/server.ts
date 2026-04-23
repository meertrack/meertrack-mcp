import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MeertrackClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { VERSION } from "./version.js";

export interface BuildServerOptions {
  /** Validated bearer (must start with `mt_live_`). */
  apiKey: string;
  /** Optional upstream override (defaults to `MEERTRACK_API_BASE_URL` or prod). */
  baseUrl?: string;
  /** Optional fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Optional hook fired after every upstream Meertrack response. The HTTP
   * transport uses it to capture `X-Request-Id` for the per-request log line.
   */
  onUpstreamResponse?: (info: {
    status: number;
    requestId: string | null;
  }) => void;
}

export const SERVER_NAME = "meertrack";

/**
 * Build a ready-to-connect `McpServer` for one bearer.
 *
 * stdio mode: called once at process start with the env-var key.
 * HTTP mode: called per request with the request's bearer so each request
 * gets an isolated client, and no mutable state is shared across bearers.
 * (See `src/transports/http.ts` for why this is not a performance mistake.)
 *
 * Protocol version negotiation is handled by the SDK at `initialize` time —
 * the server natively supports MCP 2025-11-25 (plus back-compat versions).
 * Capabilities are declared as static `tools: {}` / `prompts: {}` — both
 * lists are baked in, so no `listChanged` notifications are emitted. No
 * `resources` / `logging` / `completions` in v1.
 */
export function buildServer(opts: BuildServerOptions): McpServer {
  const client = new MeertrackClient({
    apiKey: opts.apiKey,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.onUpstreamResponse !== undefined
      ? { onUpstreamResponse: opts.onUpstreamResponse }
      : {}),
  });

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );

  registerAllTools(server, client);
  registerAllPrompts(server);

  return server;
}

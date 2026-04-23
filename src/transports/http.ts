import { Hono } from "hono";
import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  buildWwwAuthenticateHeader,
  extractHttpBearer,
  type HttpAuthContext,
} from "../auth.js";
import { buildServer } from "../server.js";
import { logger as defaultLogger, type Logger } from "../logger.js";

/**
 * Streamable HTTP transport (MCP spec 2025-11-25 §transports).
 *
 * Shape:
 *   POST /mcp    — JSON-RPC request/response, delegated to the SDK transport
 *                  which enforces the dual-Accept header, Content-Type, and
 *                  `MCP-Protocol-Version`.
 *   GET  /mcp    — 405 (V1 is stateless with no server-initiated notifications).
 *   DELETE /mcp  — 405 (V1 is stateless; `Mcp-Session-Id` is never issued).
 *   GET /health  — Fly.io health probe.
 *   GET /.well-known/oauth-protected-resource — RFC 9728 PRM stub (required
 *       by spec §Authorization for spec-conformant clients to discover how
 *       to authenticate).
 *
 * Per-request server: every POST builds a fresh `McpServer` bound to that
 * request's bearer. This is the standard stateless pattern — it isolates
 * per-key auth state and avoids cross-bearer leakage. It is NOT a performance
 * mistake. If profiling ever shows `McpServer` construction is a hot spot, the
 * fix is to hoist tool registration to module scope (tool definitions are
 * static) and only rebuild the per-request auth/client binding — **do not**
 * share a mutable server across requests with different bearers. Not a v1
 * optimization.
 */

export interface CreateHttpAppOptions {
  /** Optional upstream override (otherwise resolved from env). */
  baseUrl?: string;
  /**
   * Allowlist for the `Origin` header (DNS rebinding protection, spec
   * §transports line 104). Requests without an `Origin` header pass (non-
   * browser clients like `curl` / `npx` don't set it).
   */
  allowedOrigins: string[];
  /**
   * Public URL of the PRM document, embedded in `WWW-Authenticate` on 401s.
   * Used verbatim — include scheme + host + path.
   */
  protectedResourceMetadataUrl: string;
  /** Optional fetch override for tests. Threaded into `buildServer`. */
  fetchImpl?: typeof fetch;
  /** Optional logger override (tests use a sink that captures lines). */
  logger?: Logger;
}

export const HEALTH_PATH = "/health";
export const MCP_PATH = "/mcp";
export const PRM_PATH = "/.well-known/oauth-protected-resource";

export function createHttpApp(options: CreateHttpAppOptions) {
  const app = new Hono();

  // Origin allowlist — runs before routing so it protects every path. The SDK
  // also has deprecated built-in origin validation; we enforce it at the
  // transport edge per the spec's current guidance.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !options.allowedOrigins.includes(origin)) {
      return c.json(
        { error: { code: "forbidden_origin", message: `Origin not allowed: ${origin}` } },
        403,
      );
    }
    await next();
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true }));

  app.get(PRM_PATH, (c) =>
    c.json({
      resource: prmResourceFor(options.protectedResourceMetadataUrl),
      authorization_servers: [],
      bearer_methods_supported: ["header"],
    }),
  );

  const log = options.logger ?? defaultLogger;
  app.post(MCP_PATH, (c) => handleMcpPost(c, options, log));

  // Stateless — no server-initiated notifications, no session termination.
  // Spec allows 405 for either, as long as `Allow` advertises what IS valid.
  app.get(MCP_PATH, (c) => methodNotAllowed(c));
  app.delete(MCP_PATH, (c) => methodNotAllowed(c));
  app.all(MCP_PATH, (c) => methodNotAllowed(c));

  return app;
}

function prmResourceFor(prmUrl: string): string {
  // The `resource` in PRM is the MCP endpoint, not the PRM doc URL itself.
  // Derive it from the PRM URL by replacing the well-known suffix with `/mcp`.
  try {
    const u = new URL(prmUrl);
    u.pathname = MCP_PATH;
    return u.toString();
  } catch {
    return prmUrl;
  }
}

function methodNotAllowed(_c: Context): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    },
  );
}

async function handleMcpPost(
  c: Context,
  options: CreateHttpAppOptions,
  log: Logger,
): Promise<Response> {
  const start = Date.now();
  const protocolVersion = c.req.header("mcp-protocol-version") ?? undefined;
  const userAgent = c.req.header("user-agent") ?? undefined;

  // Peek the body once so we can log the JSON-RPC method/tool. The SDK reads
  // the request body itself, so we re-make a Request with the same body text
  // before forwarding. Body peek is cheap (single small JSON-RPC frame).
  const bodyText = await c.req.raw.text().catch(() => "");
  const peeked = peekRpcBody(bodyText);

  const finalize = (status: number, extra: Record<string, unknown> = {}): void => {
    log.log({
      event: "http_request",
      status,
      duration_ms: Date.now() - start,
      ...(peeked.method !== undefined ? { mcp_method: peeked.method } : {}),
      ...(peeked.tool !== undefined ? { tool: peeked.tool } : {}),
      ...(protocolVersion !== undefined ? { mcp_protocol_version: protocolVersion } : {}),
      ...(userAgent !== undefined ? { client_user_agent: userAgent } : {}),
      ...extra,
    });
  };

  const prmUrl = options.protectedResourceMetadataUrl;

  const authCtx: HttpAuthContext = {
    header: (name) => c.req.header(name) ?? null,
    searchParams: new URL(c.req.url).searchParams,
    protectedResourceMetadataUrl: prmUrl,
  };

  const resolution = extractHttpBearer(authCtx);
  if (!resolution.ok) {
    finalize(401);
    return unauthorizedResponse(resolution.message, resolution.wwwAuthenticate);
  }

  let upstreamRequestId: string | null = null;

  const server = buildServer({
    apiKey: resolution.apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    onUpstreamResponse: ({ requestId }) => {
      // Last upstream call wins — single tool invocation per JSON-RPC frame in
      // practice, so this is the call's request id.
      if (requestId) upstreamRequestId = requestId;
    },
  });

  // Stateless mode: `sessionIdGenerator` explicitly undefined disables session
  // tracking entirely. JSON responses (not SSE) because this server never
  // pushes notifications — simpler to reason about and lets us await full
  // completion before releasing the per-request server.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Re-construct the request because we already consumed its body above.
  const forwarded = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: bodyText,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(forwarded);
    await server.close();
    finalize(response.status, upstreamRequestId ? { meertrack_request_id: upstreamRequestId } : {});
    return response;
  } catch (err) {
    await server.close().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    finalize(500, { error: message, ...(upstreamRequestId ? { meertrack_request_id: upstreamRequestId } : {}) });
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: `Internal error: ${message}` },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Pull the JSON-RPC `method` and (when applicable) the `params.name` tool name
 * out of a request body. Tolerates malformed bodies — bad input is the SDK's
 * job to reject; logging just records what we can see.
 */
function peekRpcBody(text: string): { method?: string; tool?: string } {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as
      | { method?: unknown; params?: { name?: unknown } }
      | Array<{ method?: unknown; params?: { name?: unknown } }>;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== "object") return {};
    const method = typeof first.method === "string" ? first.method : undefined;
    const tool =
      method === "tools/call" && first.params && typeof first.params.name === "string"
        ? first.params.name
        : undefined;
    return {
      ...(method !== undefined ? { method } : {}),
      ...(tool !== undefined ? { tool } : {}),
    };
  } catch {
    return {};
  }
}

function unauthorizedResponse(message: string, wwwAuthenticate: string): Response {
  return new Response(
    JSON.stringify({ error: { code: "unauthorized", message } }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": wwwAuthenticate,
      },
    },
  );
}

/**
 * Resolve the PRM URL from config + the incoming request. Used by the
 * entrypoint when users don't override the metadata URL explicitly: derive it
 * from the first request's `Host`. For the production Fly deploy, this config
 * is set at startup via `MEERTRACK_MCP_PRM_URL` to the public HTTPS URL.
 */
export function defaultProtectedResourceMetadataUrl(host: string, protocol: "http" | "https" = "https"): string {
  return `${protocol}://${host}${PRM_PATH}`;
}

export { buildWwwAuthenticateHeader };

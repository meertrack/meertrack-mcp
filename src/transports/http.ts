import { Hono } from "hono";
import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  buildWwwAuthenticateHeader,
  extractHttpBearer,
  SUPPORTED_SCOPES,
  type HttpAuthContext,
  type OAuthConfig,
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
   * Public base URL of the PRM document — scheme + host + `PRM_PATH`.
   *
   * NOT used verbatim: only its origin is load-bearing. The URL actually
   * advertised in `WWW-Authenticate` is rebuilt from that origin plus the
   * resource identifier's path suffix (RFC 9728 §3.1), so a trailing slash or a
   * stale path here cannot produce an advertised URL that this server doesn't
   * serve. See `resourceMetadataFor`.
   */
  protectedResourceMetadataUrl: string;
  /**
   * OAuth 2.1 configuration. When set:
   *  - non-`mt_live_` bearers are verified as JWTs against `jwksUrl`
   *  - PRM advertises `issuer` in `authorization_servers`
   * When unset, only `mt_live_…` keys are accepted (pre-OAuth deployments).
   */
  oauth?: OAuthConfig;
  /** Optional fetch override for tests. Threaded into `buildServer`. */
  fetchImpl?: typeof fetch;
  /** Optional logger override (tests use a sink that captures lines). */
  logger?: Logger;
}

export const HEALTH_PATH = "/health";
export const MCP_PATH = "/mcp";
export const PRM_PATH = "/.well-known/oauth-protected-resource";

/** Resolved identity of this resource server, derived from a single config value. */
export interface ResourceMetadata {
  /** RFC 8707 resource identifier — byte-identical to what the AS binds as `aud`. */
  resource: string;
  /** Every path the PRM document is served from. */
  paths: string[];
  /** URL advertised in `WWW-Authenticate: … resource_metadata=…`. */
  canonicalUrl: string;
}

/**
 * Resolve the resource identifier and where its metadata lives.
 *
 * `resource` is read from `oauth.audience` — the config value that already
 * holds this string — rather than kept as a second hand-authored copy. Two
 * independently-maintained spellings of it is exactly the defect this replaces:
 * the PRM advertised the bare origin while the server validated `aud` with a
 * `/mcp` path, so any client that used the advertised value as its RFC 8707
 * resource indicator was rejected by the authorization server.
 *
 * NOTE the `resource == aud` equality is a fact about THIS deployment, not a
 * general rule — RFC 8707 §2 lets an AS map a resource indicator to a different
 * or abstract audience, and `aud` may be an array while `resource` is always a
 * single string.
 *
 * Every step is total. This runs at app construction, so a throw here becomes
 * `process.exit(1)` and a crash-looping deploy — an outage caused by a metadata
 * value, which is a much worse failure than serving a slightly odd document.
 */
export function resourceMetadataFor(options: CreateHttpAppOptions): ResourceMetadata {
  // Without OAuth there is no audience to read. Fall back to origin + the MCP
  // endpoint path, NOT the bare origin: the bare origin would reintroduce the
  // same mismatch in another branch, and would mean local dev and the Inspector
  // never exercise the path-suffixed discovery URL that production relies on.
  const resource = options.oauth?.audience ?? `${originOf(options.protectedResourceMetadataUrl)}${MCP_PATH}`;
  const suffix = resourcePathSuffix(resource);

  // RFC 9728 §3.1: a resource identifier with a path is discovered at
  // `/.well-known/oauth-protected-resource<path>`. `PRM_PATH + MCP_PATH` is
  // registered unconditionally as a safety net — it is the URL Claude actually
  // probes, so it must exist even if the audience is ever set to some other
  // shape. The bare `PRM_PATH` is kept for the reason in the handler comment.
  const paths = [
    ...new Set([PRM_PATH, `${PRM_PATH}${MCP_PATH}`, ...(suffix ? [`${PRM_PATH}${suffix}`] : [])]),
  ];

  // Resolve against the configured origin rather than concatenating onto the
  // configured string: `new URL` normalizes away a trailing slash or a stale
  // path, which guarantees the advertised URL is one of `paths`.
  let canonicalUrl: string;
  try {
    canonicalUrl = new URL(
      `${PRM_PATH}${suffix || MCP_PATH}`,
      options.protectedResourceMetadataUrl,
    ).toString();
  } catch {
    canonicalUrl = options.protectedResourceMetadataUrl;
  }

  return { resource, paths, canonicalUrl };
}

/**
 * Path component of a resource identifier, normalized, or `""` when there is
 * none. Note `new URL("https://host").pathname` is `"/"`, not `""` — treating
 * that as a suffix would register `…/oauth-protected-resource/` (which Hono
 * 404s, since it matches exactly) and advertise a URL that does not resolve.
 *
 * Parses only to read the path. The caller uses the *raw* audience string as
 * `resource`, never a round-tripped one: `new URL("https://h").toString()`
 * appends a slash, which would mint a third spelling of a string whose whole
 * purpose is to be byte-identical everywhere.
 */
function resourcePathSuffix(resource: string): string {
  try {
    const path = new URL(resource).pathname;
    // Opaque URIs (`urn:meertrack:mcp`) parse fine but their "pathname" is the
    // scheme-specific part with no leading slash — appending it would build
    // `/.well-known/oauth-protected-resourcemeertrack:mcp`. Only a hierarchical
    // path is a valid suffix.
    if (!path.startsWith("/")) return "";
    return path === "/" ? "" : path.replace(/\/+$/, "");
  } catch {
    // A non-URL audience is legal per RFC 8707 §2. No suffix, and critically no
    // throw — see `resourceMetadataFor`.
    return "";
  }
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

/** Headers shared by every copy of the PRM document. */
const PRM_HEADERS: Record<string, string> = {
  // Discovery happens cross-origin and before the client holds any credentials.
  // The document is public and contains no secrets — the same bytes are already
  // served to any `curl` that sends no `Origin` at all.
  "access-control-allow-origin": "*",
  // RFC 9728 §7.10 sanctions caching. Deliberately short: this document names
  // the resource identifier, and a wrong value cached for an hour is an hour of
  // failed connections plus an hour added to any rollback. It cannot shorten
  // anything cached *before* this header existed — earlier responses carried no
  // freshness information at all, so caches applied their own heuristics.
  "cache-control": "public, max-age=60",
};

export function createHttpApp(options: CreateHttpAppOptions) {
  const app = new Hono();
  const log = options.logger ?? defaultLogger;
  const { resource, paths, canonicalUrl } = resourceMetadataFor(options);

  // Origin allowlist — runs before routing so it protects every path. The SDK
  // also has deprecated built-in origin validation; we enforce it at the
  // transport edge per the spec's current guidance.
  //
  // Loopback (`http://localhost:*`, `http://127.0.0.1:*`) is always allowed:
  // this endpoint authenticates via Bearer tokens (not cookies), so DNS
  // rebinding / cross-site cookie theft isn't the threat model, and MCP
  // dev tools like the Inspector connect from a loopback origin on a
  // user-chosen port.
  app.use("*", async (c, next) => {
    // Discovery documents under `/.well-known/` are exempt. They are public,
    // unauthenticated metadata that advertise `access-control-allow-origin: *`
    // — enforcing an origin allowlist on them would contradict that header and
    // break discovery for any client not on the list, while protecting nothing:
    // the identical bytes are available to a request with no `Origin` header.
    // The rebinding threat model this allowlist exists for is about `/mcp`.
    //
    // Covers the AS-metadata redirect below and any future route in the subtree.
    // Keyed off `c.req.path`, not `c.req.url` — a substring test on the full URL
    // would be bypassable via `POST /mcp?x=/.well-known/`. Dot-segment escapes
    // are not a concern: `/.well-known/../mcp` is normalized to `/mcp` by the
    // `Request` constructor before Hono routes it.
    if (c.req.path.startsWith("/.well-known/")) return next();

    const origin = c.req.header("origin");
    if (origin && !isLoopbackOrigin(origin) && !options.allowedOrigins.includes(origin)) {
      return c.json(
        { error: { code: "forbidden_origin", message: `Origin not allowed: ${origin}` } },
        403,
      );
    }
    await next();
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true }));

  // One document, served from every path in `paths` — identical bytes.
  //
  // On serving it from the bare `PRM_PATH` too: RFC 9728 §3.3 says a client that
  // derived the bare well-known URL from a bare-origin identifier MUST NOT use a
  // document whose `resource` differs, so this is a knowing divergence rather
  // than a purely additive route. It is correct for MCP, which is the client
  // population that matters here: the 2025-11-25 authorization spec requires
  // clients to support both the path-suffixed and root locations and to try them
  // in that order, and Claude probes the suffixed path first. The bare path is a
  // compatibility shim reached only on a 404 — do not "align" it back by
  // deleting the suffixed route or reverting `resource` to the bare origin.
  const prmBody = {
    resource,
    authorization_servers: options.oauth ? [options.oauth.issuer] : [],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    ...(options.oauth ? { jwks_uri: options.oauth.jwksUrl } : {}),
    resource_name: "Meertrack MCP",
    ...(options.oauth
      ? { resource_documentation: `${options.oauth.issuer.replace(/\/$/, "")}/developers/api` }
      : {}),
  };

  for (const path of paths) {
    app.get(path, (c) => {
      // A PRM fetch with no authorized POST behind it is the leading indicator
      // of a broken authorize flow — the failure mode that went unnoticed for a
      // month because discovery was the only step that logged nothing.
      const userAgent = c.req.header("user-agent");
      log.log({
        event: "prm_fetch",
        path,
        ...(userAgent !== undefined ? { client_user_agent: userAgent } : {}),
      });
      return c.json(prmBody, 200, PRM_HEADERS);
    });
  }

  // Some MCP clients (older Inspector builds) fall back to fetching AS metadata
  // from the RS's own `.well-known/oauth-authorization-server` instead of
  // following the PRM's `authorization_servers` pointer. If we 404 here, the
  // client then guesses token/authorize URLs on the RS host. Redirect to the
  // real AS metadata URL when OAuth is configured.
  app.get("/.well-known/oauth-authorization-server", (c) => {
    if (!options.oauth) return c.text("Not Found", 404);
    return c.redirect(
      `${options.oauth.issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
      302,
    );
  });

  app.post(MCP_PATH, (c) => handleMcpPost(c, options, log, canonicalUrl));

  // Stateless — no server-initiated notifications, no session termination.
  // Spec allows 405 for either, as long as `Allow` advertises what IS valid.
  app.get(MCP_PATH, (c) => methodNotAllowed(c));
  app.delete(MCP_PATH, (c) => methodNotAllowed(c));
  app.all(MCP_PATH, (c) => methodNotAllowed(c));

  return app;
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
  protectedResourceMetadataUrl: string,
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

  const authCtx: HttpAuthContext = {
    header: (name) => c.req.header(name) ?? null,
    searchParams: new URL(c.req.url).searchParams,
    // The path-suffixed URL (RFC 9728 §3.1), not the raw configured base — this
    // is Claude's primary discovery mechanism, so it must point at a document
    // whose `resource` matches the URL the client used to reach us.
    protectedResourceMetadataUrl,
    // Passed by reference on purpose, and never rewritten: `oauth.audience` is
    // what `jwtVerify` checks `aud` against for every request. Handing a mutated
    // copy down this path would change token validation for all traffic.
    ...(options.oauth !== undefined ? { oauth: options.oauth } : {}),
  };

  const resolution = await extractHttpBearer(authCtx);
  if (!resolution.ok) {
    // `auth_outcome` is what makes a 401 spike diagnosable — a bare status can't
    // distinguish "expired token" from "audience no longer matches".
    finalize(401, { auth_outcome: resolution.authOutcome });
    return unauthorizedResponse(resolution.message, resolution.wwwAuthenticate);
  }

  let upstreamRequestId: string | null = null;

  const server = buildServer({
    apiKey: resolution.bearer,
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
    const stack = err instanceof Error && err.stack ? redactStack(err.stack) : undefined;
    finalize(500, {
      error: message,
      ...(stack ? { stack } : {}),
      ...(upstreamRequestId ? { meertrack_request_id: upstreamRequestId } : {}),
    });
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

/** Drop anything that looks like a bearer/api key from a stack trace before logging. */
function redactStack(stack: string): string {
  return stack
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/(api[_-]?key["'=:\s]+)[A-Za-z0-9._-]+/gi, "$1***");
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
 * Default value for `protectedResourceMetadataUrl` when `MEERTRACK_MCP_PRM_URL`
 * is unset — derived from the public host. This is the *base*: the URL actually
 * advertised on 401s is `resourceMetadataFor().canonicalUrl`, which appends the
 * resource identifier's path suffix per RFC 9728 §3.1. Only the origin of this
 * value survives that rebuild.
 */
export function defaultProtectedResourceMetadataUrl(host: string, protocol: "http" | "https" = "https"): string {
  return `${protocol}://${host}${PRM_PATH}`;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export { buildWwwAuthenticateHeader };

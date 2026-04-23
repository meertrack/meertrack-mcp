/**
 * Bearer resolution for both transports.
 *
 * - `stdio`: key comes from `MEERTRACK_API_KEY` once at process start.
 * - `http` : key comes from the `Authorization` header per request, with a
 *            `?api_key=` query-string fallback for clients that can't set
 *            custom headers (some Claude Desktop builds, claude.ai web).
 *
 * In both modes we validate the `mt_live_` prefix locally before the first
 * upstream call — fail fast with a useful message instead of round-tripping
 * an upstream 401 for an obviously malformed key.
 */

export const API_KEY_PREFIX = "mt_live_";

/** Full pattern: `mt_live_` followed by base64url characters. */
const API_KEY_PATTERN = /^mt_live_[A-Za-z0-9_-]+$/;

/** True iff `value` begins with `mt_live_`. Does not assert length/charset. */
export function hasApiKeyPrefix(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX);
}

/** Strict format check: prefix + non-empty base64url body. */
export function isWellFormedApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export class MissingApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiKeyError";
  }
}

/**
 * stdio: resolve the bearer from the environment exactly once at startup.
 * Throws a descriptive error that the entrypoint can surface on stderr and
 * exit with. Never logs the key itself.
 */
export function resolveEnvApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env["MEERTRACK_API_KEY"];
  if (!raw || raw.trim().length === 0) {
    throw new MissingApiKeyError(
      "MEERTRACK_API_KEY is not set. Mint a key at Settings → API Keys in the Meertrack app and export it before running the MCP server.",
    );
  }
  const trimmed = raw.trim();
  if (!hasApiKeyPrefix(trimmed)) {
    throw new InvalidApiKeyError(
      "MEERTRACK_API_KEY does not start with `mt_live_`. Only production keys (`mt_live_…`) are supported.",
    );
  }
  return trimmed;
}

/**
 * HTTP mode: resolution outcome per request. Successful cases carry the
 * forwardable bearer; failures carry everything the transport needs to emit
 * a spec-conformant 401 (WWW-Authenticate header value included).
 */
export type HttpAuthResolution =
  | { ok: true; apiKey: string; source: "header" | "query" }
  | {
      ok: false;
      status: 401;
      code: "unauthorized";
      message: string;
      wwwAuthenticate: string;
    };

export interface HttpAuthContext {
  /** Case-insensitive header lookup — works for `Headers`, plain objects, and Hono's helpers. */
  header: (name: string) => string | null | undefined;
  /** Parsed search params for the inbound URL. */
  searchParams: URLSearchParams;
  /** Public URL of the `/.well-known/oauth-protected-resource` document. */
  protectedResourceMetadataUrl: string;
}

/**
 * Extract a bearer from an incoming HTTP request. Header wins over query when
 * both are set. If absent or malformed, return an `ok: false` resolution
 * carrying a fully-formed `WWW-Authenticate` header value — the transport
 * emits the 401 without touching the upstream API.
 */
export function extractHttpBearer(ctx: HttpAuthContext): HttpAuthResolution {
  const headerValue = ctx.header("authorization") ?? ctx.header("Authorization");
  const fromHeader = headerValue ? parseBearerHeader(headerValue) : null;
  const fromQuery = ctx.searchParams.get("api_key");

  const candidate = fromHeader ?? (fromQuery ? fromQuery.trim() : null);
  const source: "header" | "query" = fromHeader ? "header" : "query";
  const wwwAuthenticate = buildWwwAuthenticateHeader(ctx.protectedResourceMetadataUrl);

  if (!candidate) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message:
        "Missing API key. Send `Authorization: Bearer mt_live_…` (preferred) or `?api_key=mt_live_…` as a query-string fallback.",
      wwwAuthenticate,
    };
  }

  if (!hasApiKeyPrefix(candidate)) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message:
        "API key does not start with `mt_live_`. Only production keys are supported — mint one at Settings → API Keys.",
      wwwAuthenticate,
    };
  }

  return { ok: true, apiKey: candidate, source };
}

/** Extract a bearer token from an `Authorization` header value, or `null` if absent/malformed. */
export function parseBearerHeader(value: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

/**
 * MCP 2025-11-25 §Authorization / RFC 9728: 401 responses on the HTTP transport
 * MUST advertise where the client can find Protected Resource Metadata. Clients
 * use this to discover how to authenticate (static bearer today; OAuth in a
 * future version).
 */
export function buildWwwAuthenticateHeader(protectedResourceMetadataUrl: string): string {
  return `Bearer realm="meertrack", resource_metadata="${protectedResourceMetadataUrl}"`;
}

/**
 * Redact every `mt_live_…` token in `value`. Apply to any string before
 * writing it to logs or error messages. Also redacts `Bearer mt_live_…`.
 */
export function redactApiKeys(value: string): string {
  return value.replace(/mt_live_[A-Za-z0-9_-]+/g, "mt_live_***");
}

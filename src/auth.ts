/**
 * Bearer resolution for both transports.
 *
 * Two auth shapes are accepted on the HTTP transport:
 *
 *   1. `mt_live_…` API keys — direct, long-lived bearers minted by the
 *      Meertrack app. Used by stdio (from `MEERTRACK_API_KEY` at startup),
 *      custom-connector users who paste a key, and direct API consumers.
 *
 *   2. OAuth 2.1 access tokens (JWTs) — minted by the Meertrack authorization
 *      server at `https://meertrack.com/oauth/token`. Used by Claude's
 *      Connectors Directory and any other MCP client that does OAuth
 *      discovery. Validated locally against the AS's JWKS (cached).
 *
 * Discrimination is by prefix: anything starting with `mt_live_` goes through
 * the API-key path (regex-validated, forwarded verbatim to upstream). Anything
 * else is treated as a JWT (signature + `iss` + `aud` + `exp` verified, then
 * forwarded verbatim to upstream, which MUST also accept JWTs).
 *
 * In both modes, the bearer is forwarded verbatim — the upstream API is the
 * single source of truth for authorization decisions. Local JWT verification
 * on the MCP server is required by MCP spec §Authorization so we can emit a
 * spec-conformant 401 with `WWW-Authenticate: resource_metadata=…` without a
 * round trip.
 */

import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
} from "jose";

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
 * forwardable bearer and which auth type was used. Failures carry everything
 * the transport needs to emit a spec-conformant 401 (WWW-Authenticate header
 * value included).
 */
export type HttpAuthResolution =
  | {
      ok: true;
      bearer: string;
      authType: "api_key" | "oauth";
      source: "header" | "query";
      /** For OAuth: verified JWT claims. Undefined for api_key path. */
      claims?: JwtClaims;
    }
  | {
      ok: false;
      status: 401;
      code: "unauthorized";
      message: string;
      wwwAuthenticate: string;
    };

/** Subset of JWT claims we care about after OAuth verification. */
export interface JwtClaims {
  sub: string;
  company_id: string;
  scope?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export interface OAuthConfig {
  /** Expected `iss` claim. Must match exactly. */
  issuer: string;
  /** Expected `aud` claim. RFC 8707 audience binding — this is the canonical MCP URI. */
  audience: string;
  /** JWKS URL on the authorization server. Keys are fetched + cached by `jose`. */
  jwksUrl: string;
}

export interface HttpAuthContext {
  /** Case-insensitive header lookup — works for `Headers`, plain objects, and Hono's helpers. */
  header: (name: string) => string | null | undefined;
  /** Parsed search params for the inbound URL. */
  searchParams: URLSearchParams;
  /** Public URL of the `/.well-known/oauth-protected-resource` document. */
  protectedResourceMetadataUrl: string;
  /**
   * OAuth configuration. When undefined, only `mt_live_…` keys are accepted
   * (pre-OAuth deployments and tests that don't care about JWT paths).
   */
  oauth?: OAuthConfig;
}

/**
 * Extract a bearer from an incoming HTTP request. Header wins over query when
 * both are set. If absent or malformed, return an `ok: false` resolution
 * carrying a fully-formed `WWW-Authenticate` header value — the transport
 * emits the 401 without touching the upstream API.
 */
export async function extractHttpBearer(
  ctx: HttpAuthContext,
): Promise<HttpAuthResolution> {
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
        "Missing credentials. Send `Authorization: Bearer <mt_live_… or OAuth access token>` (preferred) or `?api_key=mt_live_…` as a query-string fallback.",
      wwwAuthenticate,
    };
  }

  // Path A: legacy `mt_live_…` API key. Regex-validate prefix + forward verbatim.
  if (hasApiKeyPrefix(candidate)) {
    return { ok: true, bearer: candidate, authType: "api_key", source };
  }

  // Path B: OAuth JWT. Requires OAuth config on the transport; if unset we
  // treat unknown-prefix bearers as invalid so pre-OAuth deployments don't
  // silently accept garbage.
  if (!ctx.oauth) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message:
        "API key does not start with `mt_live_`. Only production keys are supported — mint one at Settings → API Keys.",
      wwwAuthenticate,
    };
  }

  const verification = await verifyOAuthToken(candidate, ctx.oauth);
  if (!verification.ok) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: verification.message,
      wwwAuthenticate,
    };
  }

  return {
    ok: true,
    bearer: candidate,
    authType: "oauth",
    source,
    claims: verification.claims,
  };
}

/** Extract a bearer token from an `Authorization` header value, or `null` if absent/malformed. */
export function parseBearerHeader(value: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

/**
 * MCP spec §Authorization / RFC 9728: 401 responses on the HTTP transport
 * MUST advertise where the client can find Protected Resource Metadata.
 * Clients use this to discover the authorization server(s) and initiate the
 * OAuth 2.1 flow.
 */
export function buildWwwAuthenticateHeader(protectedResourceMetadataUrl: string): string {
  return `Bearer realm="meertrack", resource_metadata="${protectedResourceMetadataUrl}"`;
}

/**
 * Redact every `mt_live_…` token in `value`. Apply to any string before
 * writing it to logs or error messages. Also redacts `Bearer mt_live_…`.
 * JWTs are not redacted here — they're not secrets in the same way (signed,
 * short-lived, audience-bound) — but avoid logging them anyway.
 */
export function redactApiKeys(value: string): string {
  return value.replace(/mt_live_[A-Za-z0-9_-]+/g, "mt_live_***");
}

// ─── OAuth JWT verification ──────────────────────────────────────────────────

/** Cached `jose` remote JWKS resolver, keyed by JWKS URL. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl), {
      // `jose` handles its own cache internally with sensible defaults
      // (cooldown on miss, 10 min cache). Don't re-wrap.
    });
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** Test-only: clear the JWKS cache between tests. */
export function __resetJwksCache(): void {
  jwksCache.clear();
}

type OAuthVerification =
  | { ok: true; claims: JwtClaims }
  | { ok: false; message: string };

/**
 * Verify an OAuth access token locally. Checks signature (via JWKS), `iss`,
 * `aud` (exact string match, RFC 8707 audience binding — this is what
 * prevents token passthrough between resources), and `exp`. Returns the
 * subset of claims the transport cares about, or a user-safe error message.
 */
export async function verifyOAuthToken(
  token: string,
  config: OAuthConfig,
): Promise<OAuthVerification> {
  const jwks = getJwks(config.jwksUrl);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
    });
    const claims = extractClaims(payload);
    if (!claims) {
      return {
        ok: false,
        message: "Access token is missing required claims (sub, company_id).",
      };
    }
    return { ok: true, claims };
  } catch (err) {
    return { ok: false, message: classifyJwtError(err) };
  }
}

function extractClaims(payload: JWTPayload): JwtClaims | null {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const companyId =
    typeof payload["company_id"] === "string" ? (payload["company_id"] as string) : null;
  const iss = typeof payload.iss === "string" ? payload.iss : null;
  // `aud` can be a string or an array; jose's audience check has already
  // validated it, so we normalize to the first match.
  const aud = Array.isArray(payload.aud) ? payload.aud[0] ?? null : payload.aud ?? null;
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  if (!sub || !companyId || !iss || !aud || exp === null || iat === null) return null;
  const scope = typeof payload["scope"] === "string" ? (payload["scope"] as string) : undefined;
  return {
    sub,
    company_id: companyId,
    iss,
    aud,
    exp,
    iat,
    ...(scope !== undefined ? { scope } : {}),
  };
}

/**
 * Map `jose` errors to short, client-safe messages. Never leak signature
 * details — "invalid token" is enough; anything more helps attackers.
 */
function classifyJwtError(err: unknown): string {
  if (err instanceof joseErrors.JWTExpired) {
    return "Access token has expired. Refresh it at the authorization server.";
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    return "Access token claims failed validation (wrong issuer or audience).";
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return "Access token signature is invalid.";
  }
  if (err instanceof joseErrors.JOSEError) {
    return "Access token is malformed or could not be verified.";
  }
  return "Access token verification failed.";
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import {
  API_KEY_PREFIX,
  __resetJwksCache,
  buildWwwAuthenticateHeader,
  extractHttpBearer,
  hasApiKeyPrefix,
  InvalidApiKeyError,
  isWellFormedApiKey,
  MissingApiKeyError,
  parseBearerHeader,
  redactApiKeys,
  resolveEnvApiKey,
  verifyOAuthToken,
  type OAuthConfig,
} from "../src/auth.js";

const PRM_URL = "https://mcp.meertrack.com/.well-known/oauth-protected-resource";
const ISSUER = "https://meertrack.com";
const AUDIENCE = "https://mcp.meertrack.com";
const JWKS_URL = "https://meertrack.com/.well-known/jwks.json";

function ctx(
  headers: Record<string, string>,
  searchParams: Record<string, string> = {},
  oauth?: OAuthConfig,
) {
  const lookup = (name: string) => {
    const lower = name.toLowerCase();
    const match = Object.entries(headers).find(([k]) => k.toLowerCase() === lower);
    return match ? match[1] : null;
  };
  return {
    header: lookup,
    searchParams: new URLSearchParams(searchParams),
    protectedResourceMetadataUrl: PRM_URL,
    ...(oauth !== undefined ? { oauth } : {}),
  };
}

describe("prefix validators", () => {
  it("accepts a well-formed key", () => {
    expect(hasApiKeyPrefix("mt_live_abcdef")).toBe(true);
    expect(isWellFormedApiKey("mt_live_abcdef-123_XYZ")).toBe(true);
  });

  it("rejects non-prefixed keys", () => {
    expect(hasApiKeyPrefix("sk-abc")).toBe(false);
    expect(hasApiKeyPrefix("")).toBe(false);
    expect(isWellFormedApiKey("mt_live_!!!")).toBe(false);
  });

  it("exposes the canonical prefix constant", () => {
    expect(API_KEY_PREFIX).toBe("mt_live_");
  });
});

describe("resolveEnvApiKey", () => {
  it("returns the key when MEERTRACK_API_KEY is valid", () => {
    expect(resolveEnvApiKey({ MEERTRACK_API_KEY: "mt_live_abc" })).toBe("mt_live_abc");
  });

  it("throws MissingApiKeyError when unset", () => {
    expect(() => resolveEnvApiKey({})).toThrow(MissingApiKeyError);
  });

  it("throws MissingApiKeyError on empty string", () => {
    expect(() => resolveEnvApiKey({ MEERTRACK_API_KEY: "   " })).toThrow(
      MissingApiKeyError,
    );
  });

  it("throws InvalidApiKeyError on wrong prefix", () => {
    expect(() => resolveEnvApiKey({ MEERTRACK_API_KEY: "sk_wrong" })).toThrow(
      InvalidApiKeyError,
    );
  });

  it("trims surrounding whitespace", () => {
    expect(resolveEnvApiKey({ MEERTRACK_API_KEY: "  mt_live_abc\n" })).toBe(
      "mt_live_abc",
    );
  });
});

describe("parseBearerHeader", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearerHeader("Bearer mt_live_abc")).toBe("mt_live_abc");
    expect(parseBearerHeader("bearer  mt_live_abc  ")).toBe("mt_live_abc");
  });

  it("returns null for non-Bearer schemes", () => {
    expect(parseBearerHeader("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerHeader("")).toBeNull();
  });

  it("returns null for empty Bearer tokens", () => {
    expect(parseBearerHeader("Bearer   ")).toBeNull();
  });
});

describe("extractHttpBearer", () => {
  it("accepts a valid Authorization header", async () => {
    const res = await extractHttpBearer(ctx({ Authorization: "Bearer mt_live_abc" }));
    expect(res).toEqual({
      ok: true,
      bearer: "mt_live_abc",
      authType: "api_key",
      source: "header",
    });
  });

  it("falls back to ?api_key= when no header is set", async () => {
    const res = await extractHttpBearer(ctx({}, { api_key: "mt_live_xyz" }));
    expect(res).toEqual({
      ok: true,
      bearer: "mt_live_xyz",
      authType: "api_key",
      source: "query",
    });
  });

  it("prefers the header when both are present", async () => {
    const res = await extractHttpBearer(
      ctx({ Authorization: "Bearer mt_live_fromheader" }, { api_key: "mt_live_fromquery" }),
    );
    expect(res.ok && res.source).toBe("header");
    if (res.ok) expect(res.bearer).toBe("mt_live_fromheader");
  });

  it("returns 401 with WWW-Authenticate when no key is provided", async () => {
    const res = await extractHttpBearer(ctx({}));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.code).toBe("unauthorized");
      expect(res.wwwAuthenticate).toContain(`resource_metadata="${PRM_URL}"`);
      expect(res.wwwAuthenticate).toContain('realm="meertrack"');
    }
  });

  it("returns 401 when the header exists but has the wrong prefix (no OAuth configured)", async () => {
    const res = await extractHttpBearer(ctx({ Authorization: "Bearer sk_nope" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("unauthorized");
      expect(res.wwwAuthenticate).toContain("Bearer realm=");
    }
  });

  it("returns 401 when the query param exists but has the wrong prefix", async () => {
    const res = await extractHttpBearer(ctx({}, { api_key: "sk_nope" }));
    expect(res.ok).toBe(false);
  });

  it("returns 401 when the Authorization scheme is not Bearer", async () => {
    const res = await extractHttpBearer(ctx({ Authorization: "Basic abc" }));
    expect(res.ok).toBe(false);
  });

  it("handles lowercase authorization header", async () => {
    const res = await extractHttpBearer(ctx({ authorization: "Bearer mt_live_abc" }));
    expect(res.ok).toBe(true);
  });
});

describe("buildWwwAuthenticateHeader", () => {
  it("embeds the PRM URL per RFC 9728", () => {
    const value = buildWwwAuthenticateHeader("https://x.example/.well-known/oauth-protected-resource");
    expect(value).toBe(
      'Bearer realm="meertrack", resource_metadata="https://x.example/.well-known/oauth-protected-resource"',
    );
  });
});

describe("redactApiKeys", () => {
  it("replaces mt_live_ tokens in arbitrary strings", () => {
    expect(redactApiKeys("got 401 for Bearer mt_live_abc123-def")).toBe(
      "got 401 for Bearer mt_live_***",
    );
  });

  it("leaves non-matching strings untouched", () => {
    expect(redactApiKeys("nothing to redact here")).toBe("nothing to redact here");
  });

  it("redacts multiple occurrences", () => {
    expect(redactApiKeys("mt_live_AAA and mt_live_BBB")).toBe(
      "mt_live_*** and mt_live_***",
    );
  });
});

// ─── OAuth 2.1 JWT verification ──────────────────────────────────────────────

interface TestKeys {
  privateKey: KeyLike;
  publicJwk: ReturnType<typeof exportJWK> extends Promise<infer T> ? T : never;
  kid: string;
}

async function makeKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = "test-key-1";
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey, publicJwk, kid };
}

interface TokenOverrides {
  issuer?: string;
  audience?: string | string[];
  subject?: string;
  companyId?: string | undefined;
  expiresIn?: string;
  scope?: string;
  extraClaims?: Record<string, unknown>;
}

async function mintToken(keys: TestKeys, o: TokenOverrides = {}): Promise<string> {
  const hasCompanyId = "companyId" in o;
  const payload: Record<string, unknown> = {
    ...(hasCompanyId
      ? o.companyId !== undefined
        ? { company_id: o.companyId }
        : {}
      : { company_id: "comp_123" }),
    ...(o.scope !== undefined ? { scope: o.scope } : {}),
    ...(o.extraClaims ?? {}),
  };
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: keys.kid })
    .setIssuedAt()
    .setIssuer(o.issuer ?? ISSUER)
    .setAudience(o.audience ?? AUDIENCE)
    .setSubject(o.subject ?? "user_abc")
    .setExpirationTime(o.expiresIn ?? "10m")
    .sign(keys.privateKey);
}

function installJwksFetchMock(keys: TestKeys) {
  // `jose`'s `createRemoteJWKSet` goes through global fetch. Stub it to return
  // our test JWKS and assert it's scoped to the expected URL.
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [keys.publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyOAuthToken (JWT verification)", () => {
  let keys: TestKeys;
  const config: OAuthConfig = { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL };

  beforeEach(async () => {
    keys = await makeKeys();
    __resetJwksCache();
    installJwksFetchMock(keys);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a well-formed token and returns claims", async () => {
    const token = await mintToken(keys);
    const res = await verifyOAuthToken(token, config);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.sub).toBe("user_abc");
      expect(res.claims.company_id).toBe("comp_123");
      expect(res.claims.iss).toBe(ISSUER);
      expect(res.claims.aud).toBe(AUDIENCE);
    }
  });

  it("rejects a token with the wrong issuer (confused deputy defense)", async () => {
    const token = await mintToken(keys, { issuer: "https://evil.example" });
    const res = await verifyOAuthToken(token, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/claims/);
  });

  it("rejects a token with the wrong audience (RFC 8707 binding)", async () => {
    const token = await mintToken(keys, { audience: "https://other.example" });
    const res = await verifyOAuthToken(token, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/claims/);
  });

  it("rejects an expired token", async () => {
    const token = await mintToken(keys, { expiresIn: "-1m" });
    const res = await verifyOAuthToken(token, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/expired/i);
  });

  it("rejects a token with an invalid signature", async () => {
    const token = await mintToken(keys);
    const tampered = token.slice(0, -4) + "AAAA";
    const res = await verifyOAuthToken(tampered, config);
    expect(res.ok).toBe(false);
  });

  it("rejects a token missing the company_id claim", async () => {
    const token = await mintToken(keys, { companyId: undefined });
    const res = await verifyOAuthToken(token, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/claims/i);
  });

  it("rejects a malformed token string", async () => {
    const res = await verifyOAuthToken("not.a.jwt", config);
    expect(res.ok).toBe(false);
  });
});

describe("extractHttpBearer — OAuth path", () => {
  let keys: TestKeys;
  const oauth: OAuthConfig = { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL };

  beforeEach(async () => {
    keys = await makeKeys();
    __resetJwksCache();
    installJwksFetchMock(keys);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a valid JWT when OAuth is configured", async () => {
    const token = await mintToken(keys);
    const res = await extractHttpBearer(ctx({ Authorization: `Bearer ${token}` }, {}, oauth));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.authType).toBe("oauth");
      expect(res.bearer).toBe(token);
      expect(res.claims?.company_id).toBe("comp_123");
    }
  });

  it("still accepts mt_live_ keys when OAuth is configured", async () => {
    const res = await extractHttpBearer(
      ctx({ Authorization: "Bearer mt_live_abc" }, {}, oauth),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.authType).toBe("api_key");
  });

  it("returns 401 for an invalid JWT when OAuth is configured", async () => {
    const res = await extractHttpBearer(
      ctx({ Authorization: "Bearer not.a.jwt" }, {}, oauth),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.wwwAuthenticate).toContain("resource_metadata=");
  });
});

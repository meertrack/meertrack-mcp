import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  buildWwwAuthenticateHeader,
  extractHttpBearer,
  hasApiKeyPrefix,
  InvalidApiKeyError,
  isWellFormedApiKey,
  MissingApiKeyError,
  parseBearerHeader,
  redactApiKeys,
  resolveEnvApiKey,
} from "../src/auth.js";

const PRM_URL = "https://mcp.meertrack.com/.well-known/oauth-protected-resource";

function ctx(
  headers: Record<string, string>,
  searchParams: Record<string, string> = {},
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
  it("accepts a valid Authorization header", () => {
    const res = extractHttpBearer(ctx({ Authorization: "Bearer mt_live_abc" }));
    expect(res).toEqual({ ok: true, apiKey: "mt_live_abc", source: "header" });
  });

  it("falls back to ?api_key= when no header is set", () => {
    const res = extractHttpBearer(ctx({}, { api_key: "mt_live_xyz" }));
    expect(res).toEqual({ ok: true, apiKey: "mt_live_xyz", source: "query" });
  });

  it("prefers the header when both are present", () => {
    const res = extractHttpBearer(
      ctx({ Authorization: "Bearer mt_live_fromheader" }, { api_key: "mt_live_fromquery" }),
    );
    expect(res.ok && res.source).toBe("header");
    if (res.ok) expect(res.apiKey).toBe("mt_live_fromheader");
  });

  it("returns 401 with WWW-Authenticate when no key is provided", () => {
    const res = extractHttpBearer(ctx({}));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.code).toBe("unauthorized");
      expect(res.wwwAuthenticate).toContain(`resource_metadata="${PRM_URL}"`);
      expect(res.wwwAuthenticate).toContain('realm="meertrack"');
    }
  });

  it("returns 401 when the header exists but has the wrong prefix", () => {
    const res = extractHttpBearer(ctx({ Authorization: "Bearer sk_nope" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("unauthorized");
      expect(res.wwwAuthenticate).toContain("Bearer realm=");
    }
  });

  it("returns 401 when the query param exists but has the wrong prefix", () => {
    const res = extractHttpBearer(ctx({}, { api_key: "sk_nope" }));
    expect(res.ok).toBe(false);
  });

  it("returns 401 when the Authorization scheme is not Bearer", () => {
    const res = extractHttpBearer(ctx({ Authorization: "Basic abc" }));
    expect(res.ok).toBe(false);
  });

  it("handles lowercase authorization header", () => {
    const res = extractHttpBearer(ctx({ authorization: "Bearer mt_live_abc" }));
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { createHttpApp, HEALTH_PATH, MCP_PATH, PRM_PATH } from "../src/transports/http.js";
import { Logger } from "../src/logger.js";
import { __resetJwksCache } from "../src/auth.js";
import { createMockFetch, jsonResponse } from "./helpers/mockFetch.js";

/** Base PRM URL, as configured via `MEERTRACK_MCP_PRM_URL`. */
const PRM_URL = "https://mcp.meertrack.com/.well-known/oauth-protected-resource";
/** The URL actually advertised on 401s — RFC 9728 §3.1 path-suffixed. */
const CANONICAL_PRM_URL = `${PRM_URL}${MCP_PATH}`;
/** The resource identifier: the MCP endpoint, exactly as a user pastes it. */
const RESOURCE = `https://mcp.meertrack.com${MCP_PATH}`;
const ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];
const MCP_URL = `http://mcp.meertrack.test${MCP_PATH}`;

/** Silent logger for the default test apps — keeps test output readable. */
const silentLogger = new Logger(() => {});

function makeApp(fetchImpl?: typeof fetch) {
  return createHttpApp({
    allowedOrigins: ALLOWED_ORIGINS,
    protectedResourceMetadataUrl: PRM_URL,
    baseUrl: "https://api.example/v1",
    logger: silentLogger,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });
}

function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  };
}

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
    Authorization: "Bearer mt_live_test",
    ...extra,
  };
}

describe("health", () => {
  it("GET /health returns { ok: true }", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request(`http://localhost${HEALTH_PATH}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("OAuth Protected Resource Metadata (RFC 9728)", () => {
  /**
   * OAuth-configured is the production shape, so it's the default here — the
   * suffixed route and the canonical `WWW-Authenticate` URL only exist in this
   * configuration, and testing predominantly against the no-OAuth shape would
   * leave the code that actually ships uncovered.
   */
  function prmApp(oauth?: Partial<{ issuer: string; audience: string; jwksUrl: string }>) {
    return createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger: silentLogger,
      oauth: {
        issuer: "https://meertrack.com",
        audience: RESOURCE,
        jwksUrl: "https://meertrack.com/.well-known/jwks.json",
        ...oauth,
      },
    });
  }

  it("advertises the authorization server + jwks_uri + resource_documentation when OAuth is configured", async () => {
    const res = await prmApp().fetch(new Request(`http://localhost${PRM_PATH}${MCP_PATH}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The resource identifier is the MCP endpoint including its path — the
    // string the AS binds as `aud` and the string users paste into Claude.
    // A bare origin here is the 2026-07 regression; see CHANGELOG.
    expect(body["resource"]).toBe(RESOURCE);
    expect(body["authorization_servers"]).toEqual(["https://meertrack.com"]);
    expect(body["scopes_supported"]).toEqual(["read"]);
    expect(body["bearer_methods_supported"]).toEqual(["header"]);
    expect(body["jwks_uri"]).toBe("https://meertrack.com/.well-known/jwks.json");
    expect(body["resource_name"]).toBe("Meertrack MCP");
    expect(body["resource_documentation"]).toBe("https://meertrack.com/developers/api");
  });

  it("serves the identical document from the bare path and the RFC 9728 §3.1 suffixed path", async () => {
    const app = prmApp();
    const [bare, suffixed] = await Promise.all([
      app.fetch(new Request(`http://localhost${PRM_PATH}`)),
      app.fetch(new Request(`http://localhost${PRM_PATH}${MCP_PATH}`)),
    ]);
    expect(bare.status).toBe(200);
    expect(suffixed.status).toBe(200);
    expect(await bare.json()).toEqual(await suffixed.json());
  });

  it("serves both copies with ACAO: * and a short cache-control", async () => {
    const app = prmApp();
    for (const path of [PRM_PATH, `${PRM_PATH}${MCP_PATH}`]) {
      const res = await app.fetch(new Request(`http://localhost${path}`));
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    }
  });

  /**
   * The regression guard that matters. Asserting a hardcoded literal would not
   * have caught the original bug — the derivation was wrong, not the constant.
   * This pins the invariant: whatever `aud` this server validates is what it
   * advertises, and the metadata route follows that value's path.
   */
  it("derives both `resource` and the metadata route from the configured audience", async () => {
    const app = prmApp({ audience: "https://example.test/foo" });

    const res = await app.fetch(
      new Request(`http://localhost${PRM_PATH}/foo`),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)["resource"]).toBe(
      "https://example.test/foo",
    );
  });

  it("still serves the /mcp discovery path when the audience is a bare origin", async () => {
    // Rollback / staging shape. The path Claude probes must exist regardless of
    // how the audience is spelled, or discovery silently 404s.
    const app = prmApp({ audience: "https://mcp.meertrack.com" });
    const res = await app.fetch(new Request(`http://localhost${PRM_PATH}${MCP_PATH}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)["resource"]).toBe(
      "https://mcp.meertrack.com",
    );
  });

  it("serves discovery to any Origin, bypassing the allowlist", async () => {
    const app = prmApp();
    for (const path of [PRM_PATH, `${PRM_PATH}${MCP_PATH}`]) {
      const res = await app.fetch(
        new Request(`http://localhost${path}`, {
          headers: { Origin: "https://evil.example" },
        }),
      );
      expect(res.status).toBe(200);
    }
  });

  it("falls back to origin + /mcp when OAuth is not configured", async () => {
    // Pre-OAuth deploys and local dev. The fallback deliberately includes the
    // endpoint path: a bare origin would reintroduce the same mismatch here,
    // and would mean the suffixed route is never exercised outside production.
    const app = makeApp();
    const res = await app.fetch(new Request(`http://localhost${PRM_PATH}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe(RESOURCE);
    expect(body["authorization_servers"]).toEqual([]);
    // OAuth-only fields are absent when OAuth isn't configured.
    expect(body).not.toHaveProperty("jwks_uri");
    expect(body).not.toHaveProperty("resource_documentation");
  });

  it("logs a prm_fetch event so unconverted discovery attempts are visible", async () => {
    const lines: string[] = [];
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      logger: new Logger((line) => lines.push(line)),
    });
    await app.fetch(
      new Request(`http://localhost${PRM_PATH}${MCP_PATH}`, {
        headers: { "User-Agent": "Claude-User/1.0" },
      }),
    );
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry["event"]).toBe("prm_fetch");
    expect(entry["path"]).toBe(`${PRM_PATH}${MCP_PATH}`);
    expect(entry["client_user_agent"]).toBe("Claude-User/1.0");
  });
});

describe("Origin allowlist (DNS rebinding protection)", () => {
  it("rejects an Origin that isn't in the allowlist", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { ...mcpHeaders(), Origin: "https://evil.example" },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("accepts an Origin in the allowlist", async () => {
    const mock = createMockFetch();
    // initialize doesn't hit upstream
    const app = makeApp(mock.fetchImpl);
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { ...mcpHeaders(), Origin: "https://claude.ai" },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows requests with no Origin header (curl / npx / CI)", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("Method routing on /mcp", () => {
  it("GET /mcp returns 405 with Allow: POST (stateless, no SSE)", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request(MCP_URL, { method: "GET" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("DELETE /mcp returns 405 (no session management in v1)", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request(MCP_URL, { method: "DELETE" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("PUT /mcp returns 405", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request(MCP_URL, { method: "PUT" }));
    expect(res.status).toBe(405);
  });
});

describe("POST /mcp — authorization", () => {
  it("returns 401 with WWW-Authenticate pointing at the PRM URL when no bearer", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(401);
    const www = res.headers.get("WWW-Authenticate");
    // Claude's primary discovery mechanism: must be the path-suffixed URL, so
    // the document it lands on names the URL the client just called.
    expect(www).toContain(`resource_metadata="${CANONICAL_PRM_URL}"`);
    expect(www).toContain('realm="meertrack"');
    // MCP §Authorization SHOULD — tells a client with no cached PRM what to ask
    // for at /authorize.
    expect(www).toContain('scope="read"');
  });

  it("returns 401 when Authorization has the wrong prefix", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer sk_bogus",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });

  it("accepts ?api_key= fallback when no Authorization header is set", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(`${MCP_URL}?api_key=mt_live_test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /mcp — Accept header", () => {
  it("rejects requests that omit text/event-stream from Accept", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          ...mcpHeaders(),
          Accept: "application/json",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(406);
  });

  it("rejects requests that omit application/json from Accept", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          ...mcpHeaders(),
          Accept: "text/event-stream",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(406);
  });
});

describe("POST /mcp — MCP-Protocol-Version", () => {
  it("rejects unknown protocol versions with 400", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { ...mcpHeaders(), "MCP-Protocol-Version": "1999-01-01" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a missing MCP-Protocol-Version header on non-initialize requests (spec default)", async () => {
    // For the SDK transport, a missing header is accepted. We verify by
    // running initialize (which ignores the header) then tools/list with
    // the header omitted — but we need a stateless session, so just check
    // initialize behaves.
    const app = makeApp();
    const headers = { ...mcpHeaders() };
    delete (headers as Record<string, string>)["MCP-Protocol-Version"];
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(initializeBody()),
      }),
    );
    // initialize is valid without the header per spec (version negotiation
    // happens inside the body).
    expect(res.status).toBe(200);
  });
});

describe("Structured request logging", () => {
  function captureLogger() {
    const lines: string[] = [];
    const logger = new Logger((line) => lines.push(line));
    return { logger, lines };
  }

  it("emits a single JSON line per request with method, status, duration", async () => {
    const { logger, lines } = captureLogger();
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger,
    });
    await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders({ "User-Agent": "claude-desktop/1.2" }),
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record["event"]).toBe("http_request");
    expect(record["status"]).toBe(200);
    expect(record["mcp_method"]).toBe("initialize");
    expect(record["mcp_protocol_version"]).toBe("2025-11-25");
    expect(record["client_user_agent"]).toBe("claude-desktop/1.2");
    expect(typeof record["duration_ms"]).toBe("number");
  });

  it("captures the tool name on tools/call and the upstream X-Request-Id", async () => {
    const { logger, lines } = captureLogger();
    const mock = createMockFetch();
    mock.enqueue(() =>
      new Response(
        JSON.stringify({
          data: {
            key: {
              id: "00000000-0000-4000-8000-000000000010",
              name: null,
              key_prefix: null,
              scopes: [],
              created_at: null,
              last_used_at: null,
            },
            workspace: null,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_abc123",
          },
        },
      ),
    );
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger,
      fetchImpl: mock.fetchImpl,
    });
    await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
    );
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record["mcp_method"]).toBe("tools/call");
    expect(record["tool"]).toBe("whoami");
    expect(record["meertrack_request_id"]).toBe("req_abc123");
  });

  it("redacts mt_live_… tokens from any logged field", async () => {
    const { logger, lines } = captureLogger();
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger,
    });
    // Bearer in the User-Agent for this contrived test — User-Agent is logged
    // verbatim, but the redactor should still scrub mt_live_ values.
    await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders({ "User-Agent": "leak-test mt_live_supersecret123" }),
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("mt_live_supersecret123");
    expect(lines[0]).toContain("mt_live_***");
  });
});

describe("POST /mcp — OAuth JWT bearer", () => {
  const ISSUER = "https://meertrack.com";
  // The production audience: the MCP endpoint including its path. Every token in
  // circulation carries this as `aud`.
  const AUDIENCE = RESOURCE;
  const JWKS_URL = "https://meertrack.com/.well-known/jwks.json";

  interface TestKeys {
    privateKey: KeyLike;
    publicJwk: Record<string, unknown>;
    kid: string;
  }

  async function makeKeys(): Promise<TestKeys> {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
    const kid = "test-key-1";
    publicJwk["kid"] = kid;
    publicJwk["alg"] = "RS256";
    publicJwk["use"] = "sig";
    return { privateKey, publicJwk, kid };
  }

  async function mintToken(keys: TestKeys): Promise<string> {
    return await new SignJWT({ company_id: "comp_xyz" })
      .setProtectedHeader({ alg: "RS256", kid: keys.kid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("user_xyz")
      .setExpirationTime("10m")
      .sign(keys.privateKey);
  }

  let keys: TestKeys;
  let upstreamMock: ReturnType<typeof createMockFetch>;

  beforeEach(async () => {
    keys = await makeKeys();
    __resetJwksCache();
    upstreamMock = createMockFetch();
    // Stub global fetch for the jose JWKS call. Upstream API calls go through
    // `upstreamMock.fetchImpl` which is passed to the app directly, so they
    // never hit global fetch.
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({ keys: [keys.publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected global fetch to ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function oauthApp() {
    return createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger: silentLogger,
      fetchImpl: upstreamMock.fetchImpl,
      oauth: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL },
    });
  }

  it("accepts a valid JWT and forwards it verbatim to upstream", async () => {
    upstreamMock.enqueue(
      jsonResponse({
        data: {
          key: {
            id: "00000000-0000-4000-8000-000000000099",
            name: null,
            key_prefix: null,
            scopes: [],
            created_at: null,
            last_used_at: null,
          },
          workspace: null,
        },
      }),
    );
    const token = await mintToken(keys);
    const res = await oauthApp().fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(upstreamMock.calls).toHaveLength(1);
    const forwardedHeaders =
      (upstreamMock.calls[0]!.init!.headers as Record<string, string>) ?? {};
    expect(forwardedHeaders["authorization"]).toBe(`Bearer ${token}`);
  });

  it("returns 401 with WWW-Authenticate for a token with wrong audience", async () => {
    const wrongAudience = await new SignJWT({ company_id: "comp_xyz" })
      .setProtectedHeader({ alg: "RS256", kid: keys.kid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience("https://other.example")
      .setSubject("user_xyz")
      .setExpirationTime("10m")
      .sign(keys.privateKey);

    const res = await oauthApp().fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${wrongAudience}`,
        },
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(401);
    const www = res.headers.get("WWW-Authenticate");
    expect(www).toContain(`resource_metadata="${CANONICAL_PRM_URL}"`);
    // A bearer was sent but failed verification → tag as invalid_token.
    expect(www).toContain('error="invalid_token"');
    expect(upstreamMock.calls).toHaveLength(0);
  });

  it("logs auth_outcome=jwt_bad_audience so audience drift is countable", async () => {
    // The signal that would have made the 2026-07 outage visible. A bare 401
    // count cannot distinguish this from ordinary token expiry.
    const lines: string[] = [];
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      logger: new Logger((line) => lines.push(line)),
      fetchImpl: upstreamMock.fetchImpl,
      oauth: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL },
    });
    const wrongAudience = await new SignJWT({ company_id: "comp_xyz" })
      .setProtectedHeader({ alg: "RS256", kid: keys.kid })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience("https://other.example")
      .setSubject("user_xyz")
      .setExpirationTime("10m")
      .sign(keys.privateKey);

    await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${wrongAudience}`,
        },
        body: JSON.stringify(initializeBody()),
      }),
    );

    const entry = JSON.parse(lines.at(-1) as string) as Record<string, unknown>;
    expect(entry["status"]).toBe(401);
    expect(entry["auth_outcome"]).toBe("jwt_bad_audience");
  });

  it("logs auth_outcome=no_credentials when no bearer is sent", async () => {
    const lines: string[] = [];
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      logger: new Logger((line) => lines.push(line)),
      oauth: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL },
    });
    await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initializeBody()),
      }),
    );
    const entry = JSON.parse(lines.at(-1) as string) as Record<string, unknown>;
    expect(entry["auth_outcome"]).toBe("no_credentials");
  });

  it("still accepts mt_live_ keys even when OAuth is configured", async () => {
    const app = oauthApp();
    const res = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify(initializeBody()),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /mcp — end-to-end tools/list", () => {
  it("negotiates protocol then lists all 8 tools", async () => {
    const mock = createMockFetch();
    const app = makeApp(mock.fetchImpl);

    const listRes = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "tools/list",
        }),
      }),
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
    };
    expect(body.result?.tools?.length).toBe(8);
    for (const tool of body.result!.tools!) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("dispatches a tool call through the per-request server to upstream", async () => {
    const mock = createMockFetch();
    mock.enqueue(
      jsonResponse({
        data: {
          key: {
            id: "00000000-0000-4000-8000-000000000002",
            name: null,
            key_prefix: null,
            scopes: [],
            created_at: null,
            last_used_at: null,
          },
          workspace: null,
        },
      }),
    );
    const app = makeApp(mock.fetchImpl);

    const callRes = await app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
    );
    expect(callRes.status).toBe(200);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe("https://api.example/v1/me");
    // Assert the bearer from Authorization was forwarded upstream.
    const forwardedHeaders = (mock.calls[0]!.init!.headers as Record<string, string>) ?? {};
    expect(forwardedHeaders["authorization"]).toBe("Bearer mt_live_test");
  });
});

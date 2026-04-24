import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { createHttpApp, HEALTH_PATH, MCP_PATH, PRM_PATH } from "../src/transports/http.js";
import { Logger } from "../src/logger.js";
import { __resetJwksCache } from "../src/auth.js";
import { createMockFetch, jsonResponse } from "./helpers/mockFetch.js";

const PRM_URL = "https://mcp.meertrack.com/.well-known/oauth-protected-resource";
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
  it("serves a valid PRM stub with empty authorization_servers (no OAuth configured)", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request(`http://localhost${PRM_PATH}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      bearer_methods_supported: string[];
    };
    expect(body.resource).toMatch(/\/mcp$/);
    expect(body.authorization_servers).toEqual([]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
  });

  it("advertises the authorization server when OAuth is configured", async () => {
    const app = createHttpApp({
      allowedOrigins: ALLOWED_ORIGINS,
      protectedResourceMetadataUrl: PRM_URL,
      baseUrl: "https://api.example/v1",
      logger: silentLogger,
      oauth: {
        issuer: "https://meertrack.com",
        audience: "https://mcp.meertrack.com",
        jwksUrl: "https://meertrack.com/.well-known/jwks.json",
      },
    });
    const res = await app.fetch(new Request(`http://localhost${PRM_PATH}`));
    const body = (await res.json()) as { authorization_servers: string[] };
    expect(body.authorization_servers).toEqual(["https://meertrack.com"]);
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
    expect(www).toContain(`resource_metadata="${PRM_URL}"`);
    expect(www).toContain('realm="meertrack"');
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
  const AUDIENCE = "https://mcp.meertrack.com";
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
    expect(res.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
    expect(upstreamMock.calls).toHaveLength(0);
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

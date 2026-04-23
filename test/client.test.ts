import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BASE_URL,
  MeertrackApiError,
  MeertrackClient,
  resolveBaseUrl,
  toApiError,
} from "../src/client.js";
import { VERSION } from "../src/version.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function mockFetch(factory: () => Response): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({ url, init: init as RequestInit | undefined });
    return factory();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
}

describe("resolveBaseUrl", () => {
  beforeEach(() => {
    delete process.env["MEERTRACK_API_BASE_URL"];
  });
  afterEach(() => {
    delete process.env["MEERTRACK_API_BASE_URL"];
  });

  it("defaults to production", () => {
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it("honors MEERTRACK_API_BASE_URL", () => {
    process.env["MEERTRACK_API_BASE_URL"] = "https://staging.example/v1";
    expect(resolveBaseUrl()).toBe("https://staging.example/v1");
  });

  it("prefers explicit override", () => {
    process.env["MEERTRACK_API_BASE_URL"] = "https://staging.example/v1";
    expect(resolveBaseUrl("https://override.example/v1")).toBe("https://override.example/v1");
  });

  it("strips trailing slashes", () => {
    expect(resolveBaseUrl("https://x.example/v1/")).toBe("https://x.example/v1");
  });
});

describe("MeertrackClient — request wiring", () => {
  it("sends Bearer auth and a User-Agent", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ data: {} }));
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await client.me();
    expect(calls).toHaveLength(1);
    const headers = (calls[0]!.init!.headers as Record<string, string>) ?? {};
    expect(headers["authorization"]).toBe("Bearer mt_live_abc");
    expect(headers["accept"]).toBe("application/json");
    expect(headers["user-agent"]).toBe(`meertrack-mcp/${VERSION}`);
  });

  it("hits the right paths", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ data: {} }));
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await client.me();
    await client.getCompetitor("5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01");
    await client.listLatestDigests();
    await client.getDigest("f12a8c44-44b2-4e30-9f3d-66dde4ab2f10");
    await client.getActivityItem("9f6d22aa-3c72-4a31-b81a-0e72a3c44b11");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example/v1/me",
      "https://api.example/v1/competitors/5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
      "https://api.example/v1/digests/latest",
      "https://api.example/v1/digests/f12a8c44-44b2-4e30-9f3d-66dde4ab2f10",
      "https://api.example/v1/activity/9f6d22aa-3c72-4a31-b81a-0e72a3c44b11",
    ]);
  });

  it("encodes competitor ids as a comma-joined `id` query param", async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ data: [] }));
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await client.listCompetitors({ active: true, ids: ["AAA", "BBB"], expand: "full" });
    expect(calls[0]!.url).toBe(
      "https://api.example/v1/competitors?active=true&id=AAA%2CBBB&expand=full",
    );
  });

  it("encodes activity filters (competitor_id/section/change_type/from/to/limit/cursor)", async () => {
    const { fetchImpl, calls } = mockFetch(
      jsonResponse({ data: [], pagination: { next_cursor: null, has_more: false, total: 0 } }),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await client.listActivity({
      competitor_ids: ["A", "B"],
      sections: ["blog-posts", "pricing"],
      change_types: ["added", "updated"],
      from: "2026-04-01T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
      limit: 50,
      cursor: "abc",
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("competitor_id")).toBe("A,B");
    expect(url.searchParams.get("section")).toBe("blog-posts,pricing");
    expect(url.searchParams.get("change_type")).toBe("added,updated");
    expect(url.searchParams.get("from")).toBe("2026-04-01T00:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-04-23T00:00:00Z");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("cursor")).toBe("abc");
  });

  it("omits empty activity filter arrays from the query string", async () => {
    const { fetchImpl, calls } = mockFetch(
      jsonResponse({ data: [], pagination: { next_cursor: null, has_more: false, total: 0 } }),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await client.listActivity({
      competitor_ids: [],
      sections: [],
      change_types: [],
    });
    expect(calls[0]!.url).toBe("https://api.example/v1/activity");
  });
});

describe("MeertrackClient — error mapping", () => {
  it("throws MeertrackApiError with upstream code/message on 401", async () => {
    const { fetchImpl } = mockFetch(() =>
      new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Missing or invalid API key" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      name: "MeertrackApiError",
      status: 401,
      code: "unauthorized",
      message: "Missing or invalid API key",
    });
  });

  it("carries rateLimitReset epoch seconds from X-RateLimit-Reset on 429", async () => {
    const { fetchImpl } = mockFetch(() =>
      new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "Rate limit exceeded" } }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-reset": "1745418120",
          },
        },
      ),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      rateLimitReset: 1745418120,
    });
  });

  it("distinguishes competitor_inactive from forbidden_competitor", async () => {
    const { fetchImpl } = mockFetch(() =>
      new Response(
        JSON.stringify({
          error: { code: "competitor_inactive", message: 'Competitor "x" is deactivated.' },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      status: 403,
      code: "competitor_inactive",
    });
  });

  it("falls back to http_<status> when upstream returns non-JSON", async () => {
    const { fetchImpl } = mockFetch(() =>
      new Response("<html>Fly platform error</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      status: 502,
      code: "http_502",
    });
  });

  it("wraps network failures in MeertrackApiError with transport_error", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND api.meertrack.com");
    }) as typeof fetch;
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      name: "MeertrackApiError",
      status: 0,
      code: "transport_error",
    });
  });

  it("wraps malformed-JSON 200 responses in invalid_response", async () => {
    const { fetchImpl } = mockFetch(() =>
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl,
    });
    await expect(client.me()).rejects.toMatchObject({
      name: "MeertrackApiError",
      code: "invalid_response",
    });
  });
});

describe("toApiError helper", () => {
  it("is an instanceof MeertrackApiError", async () => {
    const res = new Response(JSON.stringify({ error: { code: "not_found", message: "nope" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    const err = await toApiError(res);
    expect(err).toBeInstanceOf(MeertrackApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
  });

  it("does not consume X-RateLimit-Reset if the header is non-numeric", async () => {
    const res = new Response(JSON.stringify({ error: { code: "rate_limited", message: "x" } }), {
      status: 429,
      headers: { "content-type": "application/json", "x-ratelimit-reset": "not-a-number" },
    });
    const err = await toApiError(res);
    expect(err.rateLimitReset).toBeUndefined();
  });
});

describe("no client-side retry", () => {
  it("calls fetch exactly once per method invocation, even on 429", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "rate_limited", message: "x" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new MeertrackClient({
      baseUrl: "https://api.example/v1",
      apiKey: "mt_live_abc",
      fetchImpl: spy as unknown as typeof fetch,
    });
    await expect(client.me()).rejects.toBeInstanceOf(MeertrackApiError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

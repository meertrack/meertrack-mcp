import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpPair, type McpPair } from "./helpers/mcpPair.js";
import { createMockFetch, errorResponse, jsonResponse, type MockFetchHandle } from "./helpers/mockFetch.js";
import { TOOL_NAMES } from "../src/tools/index.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const COMPETITOR_ID = "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01";
const DIGEST_ID = "f12a8c44-44b2-4e30-9f3d-66dde4ab2f10";
const ACTIVITY_ID = "9f6d22aa-3c72-4a31-b81a-0e72a3c44b11";

const ME_BODY = {
  data: {
    key: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Test key",
      key_prefix: "mt_live",
      scopes: [],
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: null,
    },
    workspace: {
      id: WORKSPACE_ID,
      name: "Test workspace",
      created_at: "2026-01-01T00:00:00Z",
      subscription: {
        tier: "paid",
        status: "active",
        competitor_limit: 10,
        competitors_used: 3,
        current_period_end: "2026-12-01T00:00:00Z",
        trial_ends_at: null,
      },
      rate_limit: {
        window_seconds: 60,
        requests_per_window: 60,
        remaining_this_instance: 59,
        reset_at: "2026-04-23T00:01:00Z",
      },
    },
  },
};

const COMPETITOR_DETAIL = {
  id: COMPETITOR_ID,
  name: "Acme",
  website: "https://acme.example",
  category: "SaaS",
  image_icon: null,
  created_at: "2026-01-01T00:00:00Z",
  active: true,
  social: {
    linkedin: null,
    twitter: null,
    facebook: null,
    instagram: null,
    youtube: null,
    tiktok: null,
  },
  pages: {
    pricing: null,
    case_studies: null,
    blog: null,
    press: null,
    release_notes: null,
    job_listings: null,
    events: null,
    shopify: null,
  },
};

const COMPETITOR_LIST_BODY = { data: [COMPETITOR_DETAIL] };

const COMPETITOR_OVERVIEW_BODY = {
  data: {
    id: COMPETITOR_ID,
    name: "Acme",
    website: "https://acme.example",
    category: "SaaS",
    image_icon: null,
    created_at: "2026-01-01T00:00:00Z",
    social: COMPETITOR_DETAIL.social,
    pages: COMPETITOR_DETAIL.pages,
    items: {
      "blog-posts": [],
      "press-posts": [],
      "case-studies": [],
      "job-listings": [],
      pricing: [],
      messaging: [],
      "metrics-claimed": [],
      logos: [],
      "linkedin-posts": [],
      "youtube-videos": [],
      events: [],
    },
  },
};

const ACTIVITY_ITEM = {
  id: ACTIVITY_ID,
  section: "blog-posts",
  change_type: "added",
  change_date: "2026-04-20T00:00:00Z",
  competitor: { id: COMPETITOR_ID, name: "Acme" },
  data: {
    competitor: "Acme",
    tags: [],
    discovered_at: "2026-04-20T00:00:00Z",
    title: "New post",
    url: "https://acme.example/blog/new-post",
  },
};

const ACTIVITY_LIST_BODY = {
  data: [ACTIVITY_ITEM],
  pagination: { next_cursor: "abc123", has_more: true, total: 42 },
};

const ACTIVITY_DETAIL_BODY = {
  data: {
    id: ACTIVITY_ID,
    section: "blog-posts",
    competitor: { id: COMPETITOR_ID, name: "Acme" },
    payload: ACTIVITY_ITEM.data,
  },
};

const DIGEST = {
  id: DIGEST_ID,
  competitor: { id: COMPETITOR_ID, name: "Acme" },
  period_start: "2026-04-14T00:00:00Z",
  period_end: "2026-04-20T00:00:00Z",
  summary: { executive_summary: "Acme shipped a new pricing tier." },
  update_count: 5,
  tags: [],
  created_at: "2026-04-21T00:00:00Z",
};

const DIGEST_LIST_BODY = { data: [DIGEST], pagination: { next_cursor: null, has_more: false } };
const DIGEST_LATEST_BODY = { data: [DIGEST] };
const DIGEST_BODY = { data: DIGEST };

// ─── Helpers ──────────────────────────────────────────────────────────────

let fetchMock: MockFetchHandle;
let pair: McpPair;

beforeEach(async () => {
  fetchMock = createMockFetch();
  pair = await createMcpPair({ fetchImpl: fetchMock.fetchImpl });
});

afterEach(async () => {
  await pair.close();
});

function expectToolSuccess(result: Awaited<ReturnType<typeof pair.client.callTool>>): void {
  expect(result.isError).not.toBe(true);
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.structuredContent).toBeDefined();
}

// ─── tools/list ───────────────────────────────────────────────────────────

describe("tools/list", () => {
  it("exposes all 8 read-only tools with input and output schemas", async () => {
    const { tools } = await pair.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBeUndefined();
      expect(typeof tool.title).toBe("string");
      expect(tool.title!.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });
});

// ─── Per-tool handler behavior ────────────────────────────────────────────

describe("whoami", () => {
  it("calls GET /me and returns the body as structuredContent", async () => {
    fetchMock.enqueue(jsonResponse(ME_BODY));
    const result = await pair.client.callTool({ name: "whoami", arguments: {} });
    expectToolSuccess(result);
    expect(fetchMock.calls[0]!.url).toBe("https://api.example/v1/me");
    expect(result.structuredContent).toEqual(ME_BODY);
  });
});

describe("list_competitors", () => {
  it("defaults to expand=full and wires filters into the query string", async () => {
    fetchMock.enqueue(jsonResponse(COMPETITOR_LIST_BODY));
    const result = await pair.client.callTool({
      name: "list_competitors",
      arguments: {
        active: true,
        ids: [COMPETITOR_ID],
      },
    });
    expectToolSuccess(result);
    const url = new URL(fetchMock.calls[0]!.url);
    expect(url.pathname).toBe("/v1/competitors");
    expect(url.searchParams.get("active")).toBe("true");
    expect(url.searchParams.get("id")).toBe(COMPETITOR_ID);
    expect(url.searchParams.get("expand")).toBe("full");
    expect(result.structuredContent).toEqual(COMPETITOR_LIST_BODY);
  });

  it("rejects malformed uuids in ids before issuing a request", async () => {
    const result = await pair.client.callTool({
      name: "list_competitors",
      arguments: { ids: ["not-a-uuid"] },
    });
    // Input validation is an MCP protocol-level error surfaced as isError, not
    // a REST-mapped tool error. Either way: no upstream fetch was issued.
    expect(fetchMock.calls).toHaveLength(0);
    expect(result.isError).toBe(true);
  });
});

describe("get_competitor", () => {
  it("calls GET /competitors/{id} with the competitor id", async () => {
    fetchMock.enqueue(jsonResponse(COMPETITOR_OVERVIEW_BODY));
    const result = await pair.client.callTool({
      name: "get_competitor",
      arguments: { id: COMPETITOR_ID },
    });
    expectToolSuccess(result);
    expect(fetchMock.calls[0]!.url).toBe(`https://api.example/v1/competitors/${COMPETITOR_ID}`);
  });

  it("rejects non-uuid ids at the input boundary", async () => {
    const result = await pair.client.callTool({
      name: "get_competitor",
      arguments: { id: "not-a-uuid" },
    });
    expect(fetchMock.calls).toHaveLength(0);
    expect(result.isError).toBe(true);
  });
});

describe("list_activities", () => {
  it("wires all filters and defaults limit to 50", async () => {
    fetchMock.enqueue(jsonResponse(ACTIVITY_LIST_BODY));
    const result = await pair.client.callTool({
      name: "list_activities",
      arguments: {
        competitor_ids: [COMPETITOR_ID],
        sections: ["blog-posts", "pricing"],
        change_types: ["added"],
        from: "2026-04-16T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
      },
    });
    expectToolSuccess(result);
    const url = new URL(fetchMock.calls[0]!.url);
    expect(url.searchParams.get("competitor_id")).toBe(COMPETITOR_ID);
    expect(url.searchParams.get("section")).toBe("blog-posts,pricing");
    expect(url.searchParams.get("change_type")).toBe("added");
    expect(url.searchParams.get("from")).toBe("2026-04-16T00:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-04-23T00:00:00Z");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("round-trips a cursor to the next page", async () => {
    // First call returns a non-null cursor; second call passes that cursor.
    fetchMock.enqueue(jsonResponse(ACTIVITY_LIST_BODY));
    fetchMock.enqueue(
      jsonResponse({
        data: [],
        pagination: { next_cursor: null, has_more: false, total: 42 },
      }),
    );
    const first = await pair.client.callTool({ name: "list_activities", arguments: {} });
    expectToolSuccess(first);
    const firstPagination = (
      first.structuredContent as { pagination: { next_cursor: string | null; has_more: boolean } }
    ).pagination;
    expect(firstPagination.has_more).toBe(true);
    expect(firstPagination.next_cursor).toBe("abc123");

    const second = await pair.client.callTool({
      name: "list_activities",
      arguments: { cursor: firstPagination.next_cursor },
    });
    expectToolSuccess(second);
    const secondUrl = new URL(fetchMock.calls[1]!.url);
    expect(secondUrl.searchParams.get("cursor")).toBe("abc123");
    const secondPagination = (
      second.structuredContent as { pagination: { has_more: boolean } }
    ).pagination;
    expect(secondPagination.has_more).toBe(false);
  });

  it("maps upstream 429 with X-RateLimit-Reset into a retry-hint tool error", async () => {
    fetchMock.enqueue(
      errorResponse(429, "rate_limited", "Rate limit exceeded.", {
        "x-ratelimit-reset": "1745418120",
      }),
    );
    const result = await pair.client.callTool({ name: "list_activities", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("reset=1745418120");
    expect(text).toContain("2025-04-23T14:22:00.000Z");
  });
});

describe("get_activity_item", () => {
  it("calls GET /activity/{row_uuid}", async () => {
    fetchMock.enqueue(jsonResponse(ACTIVITY_DETAIL_BODY));
    const result = await pair.client.callTool({
      name: "get_activity_item",
      arguments: { row_uuid: ACTIVITY_ID },
    });
    expectToolSuccess(result);
    expect(fetchMock.calls[0]!.url).toBe(`https://api.example/v1/activity/${ACTIVITY_ID}`);
  });

  it("maps 404 to 'No such row in this workspace.'", async () => {
    fetchMock.enqueue(errorResponse(404, "not_found", "row not found"));
    const result = await pair.client.callTool({
      name: "get_activity_item",
      arguments: { row_uuid: ACTIVITY_ID },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("No such row in this workspace.");
  });
});

describe("list_digests", () => {
  it("wires competitor_id/from/to/limit/cursor", async () => {
    fetchMock.enqueue(jsonResponse(DIGEST_LIST_BODY));
    const result = await pair.client.callTool({
      name: "list_digests",
      arguments: {
        competitor_id: COMPETITOR_ID,
        from: "2026-01-01T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
        limit: 25,
        cursor: "xyz",
      },
    });
    expectToolSuccess(result);
    const url = new URL(fetchMock.calls[0]!.url);
    expect(url.searchParams.get("competitor_id")).toBe(COMPETITOR_ID);
    expect(url.searchParams.get("from")).toBe("2026-01-01T00:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-04-23T00:00:00Z");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("cursor")).toBe("xyz");
  });
});

describe("list_latest_digests", () => {
  it("calls GET /digests/latest with no params", async () => {
    fetchMock.enqueue(jsonResponse(DIGEST_LATEST_BODY));
    const result = await pair.client.callTool({ name: "list_latest_digests", arguments: {} });
    expectToolSuccess(result);
    expect(fetchMock.calls[0]!.url).toBe("https://api.example/v1/digests/latest");
  });
});

describe("get_digest", () => {
  it("calls GET /digests/{id}", async () => {
    fetchMock.enqueue(jsonResponse(DIGEST_BODY));
    const result = await pair.client.callTool({
      name: "get_digest",
      arguments: { id: DIGEST_ID },
    });
    expectToolSuccess(result);
    expect(fetchMock.calls[0]!.url).toBe(`https://api.example/v1/digests/${DIGEST_ID}`);
  });
});

// ─── Error mapping via the tool layer ────────────────────────────────────

describe("tool-layer error mapping", () => {
  it("401 returns the mint-a-new-key text and isError", async () => {
    fetchMock.enqueue(errorResponse(401, "unauthorized", "Missing or invalid API key"));
    const result = await pair.client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      "Invalid or revoked Meertrack API key",
    );
  });

  it("403 competitor_inactive surfaces the upstream message verbatim", async () => {
    fetchMock.enqueue(
      errorResponse(403, "competitor_inactive", 'Competitor "Acme" is deactivated.'),
    );
    const result = await pair.client.callTool({
      name: "get_competitor",
      arguments: { id: COMPETITOR_ID },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Competitor "Acme" is deactivated');
  });

  it("5xx returns the retry-safe text", async () => {
    fetchMock.enqueue(errorResponse(500, "internal_error", "boom"));
    const result = await pair.client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("Upstream error; safe to retry.");
  });
});

// ─── prompts/list sanity check ────────────────────────────────────────────

describe("prompts/list", () => {
  it("exposes weekly_recap / competitor_deep_dive / whats_new", async () => {
    const { prompts } = await pair.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(
      ["competitor_deep_dive", "weekly_recap", "whats_new"].sort(),
    );
  });
});

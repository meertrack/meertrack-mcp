import { describe, expect, it } from "vitest";
import {
  ActivityListResponse,
  ApiErrorBody,
  CHANGE_TYPES,
  CompetitorDetailListResponse,
  CompetitorListResponse,
  CompetitorOverviewResponse,
  DigestLatestResponse,
  DigestListResponse,
  DigestResponse,
  MeResponse,
  Pagination,
  ActivityPagination,
  SECTION_SLUGS,
  SectionSlug,
  ChangeType,
} from "../src/types.js";

// Examples copied verbatim from openapi.yaml so these tests double as a
// contract drift detector — if the upstream yaml changes shape, the matching
// zod schema should be updated here at the same time.

describe("enum constants", () => {
  it("exports 12 section slugs and 3 change types", () => {
    expect(SECTION_SLUGS).toHaveLength(12);
    expect(CHANGE_TYPES).toEqual(["added", "updated", "removed"]);
  });

  it("rejects unknown section slugs", () => {
    expect(SectionSlug.safeParse("unknown").success).toBe(false);
    expect(SectionSlug.safeParse("blog-posts").success).toBe(true);
  });

  it("rejects unknown change types", () => {
    expect(ChangeType.safeParse("deleted").success).toBe(false);
    expect(ChangeType.safeParse("added").success).toBe(true);
  });
});

describe("Pagination / ActivityPagination", () => {
  it("accepts null next_cursor with has_more=false", () => {
    expect(Pagination.parse({ next_cursor: null, has_more: false })).toEqual({
      next_cursor: null,
      has_more: false,
    });
  });

  it("activity pagination requires total", () => {
    const ok = ActivityPagination.parse({
      next_cursor: "abc",
      has_more: true,
      total: 247,
    });
    expect(ok.total).toBe(247);
    expect(ActivityPagination.safeParse({ next_cursor: null, has_more: false }).success).toBe(
      false,
    );
  });
});

describe("ApiErrorBody", () => {
  it("parses the 401 envelope", () => {
    const parsed = ApiErrorBody.parse({
      error: { code: "unauthorized", message: "Missing or invalid API key" },
    });
    expect(parsed.error.code).toBe("unauthorized");
  });
});

describe("MeResponse", () => {
  it("accepts the example from openapi.yaml", () => {
    const result = MeResponse.safeParse({
      data: {
        key: {
          id: "8c0f2b16-6f29-4b3c-8e2a-1d5b7e1c9a44",
          name: "Production reporting key",
          key_prefix: "mt_live_a1b2",
          scopes: ["read:all"],
          created_at: "2026-01-15T09:30:00Z",
          last_used_at: "2026-04-22T11:14:53Z",
        },
        workspace: {
          id: "0c4f1d44-2811-4a32-b3ee-5b21f9c7e0ad",
          name: "Acme Inc",
          created_at: "2025-08-12T14:00:00Z",
          subscription: {
            tier: "paid",
            status: "active",
            competitor_limit: 25,
            competitors_used: 11,
            current_period_end: "2026-05-01T00:00:00Z",
            trial_ends_at: null,
          },
          rate_limit: {
            window_seconds: 60,
            requests_per_window: 60,
            remaining_this_instance: 57,
            reset_at: "2026-04-22T11:15:30Z",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("CompetitorListResponse", () => {
  it("parses the summary example", () => {
    const parsed = CompetitorListResponse.parse({
      data: [
        {
          id: "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
          name: "Acme Inc",
          website: "https://acme.example",
          category: "SaaS",
          active: true,
        },
        {
          id: "a13f0e22-c55a-44d8-8b39-f64c1a7d33b6",
          name: "Globex",
          website: "https://globex.example",
          category: null,
          active: true,
        },
      ],
    });
    expect(parsed.data).toHaveLength(2);
  });

  it("parses the expand=full example via the detail schema", () => {
    const parsed = CompetitorDetailListResponse.parse({
      data: [
        {
          id: "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
          name: "Acme Inc",
          website: "https://acme.example",
          category: "SaaS",
          image_icon: "https://cdn.meertrack.com/icons/acme.png",
          created_at: "2025-08-12T14:00:00Z",
          active: true,
          social: {
            linkedin: "https://www.linkedin.com/company/acme",
            twitter: "https://twitter.com/acme",
            facebook: null,
            instagram: null,
            youtube: "https://www.youtube.com/@acme",
            tiktok: null,
          },
          pages: {
            pricing: "https://acme.example/pricing",
            case_studies: "https://acme.example/customers",
            blog: "https://acme.example/blog",
            press: "https://acme.example/press",
            release_notes: null,
            job_listings: "https://acme.example/careers",
            events: null,
            shopify: null,
          },
        },
      ],
    });
    expect(parsed.data[0]?.social.linkedin).toContain("linkedin.com");
  });
});

describe("CompetitorOverviewResponse", () => {
  it("parses the overview example with all 11 section buckets", () => {
    const parsed = CompetitorOverviewResponse.parse({
      data: {
        id: "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
        name: "Acme Inc",
        website: "https://acme.example",
        category: "SaaS",
        image_icon: "https://cdn.meertrack.com/icons/acme.png",
        created_at: "2025-08-12T14:00:00Z",
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
        items: {
          "blog-posts": [
            {
              competitor: "Acme Inc",
              tags: ["product", "launch"],
              discovered_at: "2026-04-19T08:12:11Z",
              initial_run: false,
              title: "Introducing Acme Pulse",
              url: "https://acme.example/blog/introducing-pulse",
              description: "A new real-time analytics surface for Acme customers.",
              key_points: null,
              image_url: null,
              posted_date: "2026-04-18T15:00:00Z",
            },
          ],
          "press-posts": [],
          "case-studies": [],
          "job-listings": [
            {
              competitor: "Acme Inc",
              tags: [],
              discovered_at: "2026-03-02T08:00:00Z",
              initial_run: false,
              title: "Senior Backend Engineer",
              url: "https://jobs.acme.example/senior-backend",
              category: "Engineering",
              location: "Remote (US)",
              posted_date: "2026-03-02T00:00:00Z",
              is_live: true,
              added_at: "2026-03-02T08:00:00Z",
              removed_at: null,
            },
          ],
          pricing: [
            {
              competitor: "Acme Inc",
              tags: [],
              discovered_at: "2026-04-22T03:00:00Z",
              initial_run: false,
              pricing_data: { tiers: [{ name: "Starter", price_monthly: 49 }] },
              changes: null,
              is_live: true,
              last_updated_at: "2026-04-21T22:34:00Z",
            },
          ],
          messaging: [],
          "metrics-claimed": [],
          logos: [],
          "linkedin-posts": [],
          "youtube-videos": [],
          events: [],
        },
      },
    });
    expect(parsed.data.items["blog-posts"]).toHaveLength(1);
    expect(parsed.data.items["job-listings"][0]?.title).toBe("Senior Backend Engineer");
  });
});

describe("ActivityListResponse", () => {
  it("parses the mixed-section example", () => {
    const parsed = ActivityListResponse.parse({
      data: [
        {
          id: "9f6d22aa-3c72-4a31-b81a-0e72a3c44b11",
          section: "blog-posts",
          change_type: "added",
          change_date: "2026-04-19T08:12:11Z",
          competitor: {
            id: "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
            name: "Acme Inc",
          },
          data: {
            competitor: "Acme Inc",
            tags: ["product", "launch"],
            discovered_at: "2026-04-19T08:12:11Z",
            initial_run: false,
            title: "Introducing Acme Pulse",
            url: "https://acme.example/blog/introducing-pulse",
            description: "desc",
            key_points: null,
            image_url: null,
            posted_date: "2026-04-18T15:00:00Z",
          },
        },
        {
          id: "4d11ac88-6f0e-4ed7-9b21-77bdb9c41122",
          section: "job-listings",
          change_type: "removed",
          change_date: "2026-04-18T22:00:00Z",
          competitor: {
            id: "a13f0e22-c55a-44d8-8b39-f64c1a7d33b6",
            name: "Globex",
          },
          data: {
            competitor: "Globex",
            tags: [],
            discovered_at: "2026-03-02T08:00:00Z",
            initial_run: false,
            title: "Senior Backend Engineer",
            url: "https://jobs.globex.example/senior-backend",
            category: "Engineering",
            location: "Remote (US)",
            posted_date: "2026-03-02T00:00:00Z",
            is_live: false,
            added_at: "2026-03-02T08:00:00Z",
            removed_at: "2026-04-18T22:00:00Z",
          },
        },
      ],
      pagination: {
        next_cursor: "MjAyNi0wNC0xOFQyMjowMDowMHwwMS0xMS0wMDAw",
        has_more: true,
        total: 247,
      },
    });
    expect(parsed.data).toHaveLength(2);
    expect(parsed.pagination.total).toBe(247);
  });
});

describe("DigestListResponse / DigestResponse / DigestLatestResponse", () => {
  const digest = {
    id: "f12a8c44-44b2-4e30-9f3d-66dde4ab2f10",
    competitor: {
      id: "5b2e21a4-9d4a-4f1b-8e75-2f5a1c11de01",
      name: "Acme Inc",
    },
    period_start: "2026-04-13T00:00:00Z",
    period_end: "2026-04-20T00:00:00Z",
    summary: {
      executive_summary: "Acme launched Pulse and raised the Growth tier price.",
      themes: [
        { title: "Pricing", bullets: ["Growth tier raised from $179 to $199"] },
      ],
    },
    update_count: 14,
    tags: ["product-launch", "pricing-change"],
    created_at: "2026-04-20T05:00:00Z",
  };

  it("parses a single digest", () => {
    expect(DigestResponse.parse({ data: digest }).data.update_count).toBe(14);
  });

  it("parses a list digest response without `total`", () => {
    const parsed = DigestListResponse.parse({
      data: [digest],
      pagination: { next_cursor: null, has_more: false },
    });
    expect(parsed.pagination.has_more).toBe(false);
  });

  it("parses a latest-digest response (no pagination)", () => {
    const parsed = DigestLatestResponse.parse({ data: [digest] });
    expect(parsed.data).toHaveLength(1);
  });

  it("accepts a plain-string summary (legacy digests)", () => {
    const parsed = DigestResponse.parse({
      data: { ...digest, summary: "legacy plain string summary" },
    });
    expect(typeof parsed.data.summary).toBe("string");
  });

  it("accepts a null summary", () => {
    const parsed = DigestResponse.parse({ data: { ...digest, summary: null } });
    expect(parsed.data.summary).toBeNull();
  });

  it("tolerates unknown keys inside DigestSummary", () => {
    const parsed = DigestResponse.parse({
      data: {
        ...digest,
        summary: {
          executive_summary: "x",
          themes: [],
          brand_new_key: { nested: true },
        },
      },
    });
    expect(parsed.data.summary).toBeTruthy();
  });
});

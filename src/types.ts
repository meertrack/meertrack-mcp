import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────

export const SECTION_SLUGS = [
  "blog-posts",
  "press-posts",
  "job-listings",
  "pricing",
  "case-studies",
  "linkedin-posts",
  "youtube-videos",
  "events",
  "messaging",
  "metrics-claimed",
  "logos",
  "sitemap-urls",
] as const;

export const CHANGE_TYPES = ["added", "updated", "removed"] as const;

export const API_ERROR_CODES = [
  "invalid_parameter",
  "invalid_cursor",
  "unauthorized",
  "competitor_inactive",
  "forbidden_competitor",
  "not_found",
  "rate_limited",
  "internal_error",
] as const;

export const SectionSlug = z.enum(SECTION_SLUGS);
export type SectionSlug = z.infer<typeof SectionSlug>;

export const ChangeType = z.enum(CHANGE_TYPES);
export type ChangeType = z.infer<typeof ChangeType>;

export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

// ─── Shared helpers ───────────────────────────────────────────────────────

/** UUID param with a tool-facing description. */
export function objectId(desc: string) {
  return z
    .string()
    .uuid({ message: "Must be a UUID (as returned by a previous list call)." })
    .describe(desc);
}

/** Shared pagination query fields reused by all four list tools. */
export const paginationInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Page size. Max 500. Smaller pages keep round-trips responsive and reduce tool-result truncation risk.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous response's `pagination.next_cursor`. Omit on the first call.",
    ),
} as const;

export const Pagination = z
  .object({
    next_cursor: z
      .string()
      .nullable()
      .describe("Opaque cursor for the next page; `null` on the last page."),
    has_more: z
      .boolean()
      .describe("True iff another page is available. Equivalent to `next_cursor !== null`."),
  })
  .describe("Shared cursor-pagination envelope.");
export type Pagination = z.infer<typeof Pagination>;

export const ActivityPagination = Pagination.extend({
  total: z
    .number()
    .int()
    .min(0)
    .describe(
      "Total rows matching the filters across the entire window — not just this page. Only exposed on `/activity`.",
    ),
});
export type ActivityPagination = z.infer<typeof ActivityPagination>;

// ─── API error envelope ───────────────────────────────────────────────────

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string().describe("Machine-readable error code."),
    message: z.string().describe("Human-readable error message."),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// ─── Competitor schemas ───────────────────────────────────────────────────

export const CompetitorSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website: z.string(),
  category: z.string().nullable(),
  active: z.boolean(),
});
export type CompetitorSummary = z.infer<typeof CompetitorSummary>;

export const CompetitorSocial = z.object({
  linkedin: z.string().nullable(),
  twitter: z.string().nullable(),
  facebook: z.string().nullable(),
  instagram: z.string().nullable(),
  youtube: z.string().nullable(),
  tiktok: z.string().nullable(),
});
export type CompetitorSocial = z.infer<typeof CompetitorSocial>;

export const CompetitorPages = z.object({
  pricing: z.string().nullable(),
  case_studies: z.string().nullable(),
  blog: z.string().nullable(),
  press: z.string().nullable(),
  release_notes: z.string().nullable(),
  job_listings: z.string().nullable(),
  events: z.string().nullable(),
  shopify: z.string().nullable(),
});
export type CompetitorPages = z.infer<typeof CompetitorPages>;

// `image_icon`, `created_at`, `social`, `pages` are only returned when the
// upstream is called with `expand=full`. `expand=compact` omits them, so the
// shared tool output schema has to accept either shape.
export const CompetitorDetail = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website: z.string(),
  category: z.string().nullable(),
  image_icon: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  active: z.boolean(),
  social: CompetitorSocial.optional(),
  pages: CompetitorPages.optional(),
});
export type CompetitorDetail = z.infer<typeof CompetitorDetail>;

export const CompetitorListResponse = z.object({
  data: z.array(CompetitorSummary),
});
export type CompetitorListResponse = z.infer<typeof CompetitorListResponse>;

export const CompetitorDetailListResponse = z.object({
  data: z.array(CompetitorDetail),
});
export type CompetitorDetailListResponse = z.infer<typeof CompetitorDetailListResponse>;

// ─── Section items ────────────────────────────────────────────────────────

const sectionItemBase = {
  competitor: z.string().describe("Competitor display name (redundant with envelope.competitor.name)."),
  tags: z.array(z.string()),
  discovered_at: z.string().datetime({ offset: true }).nullable(),
  initial_run: z.boolean().nullable().optional(),
};

export const BlogPostItem = z.object({
  ...sectionItemBase,
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Stored as free-form text in the DB (`s_blog_posts.key_points text null`);
  // not a structured array despite the name.
  key_points: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  posted_date: z.string().datetime({ offset: true }).nullable().optional(),
});
export type BlogPostItem = z.infer<typeof BlogPostItem>;

export const PressPostItem = BlogPostItem;
export const CaseStudyItem = BlogPostItem;

export const JobListingItem = z.object({
  ...sectionItemBase,
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  posted_date: z.string().datetime({ offset: true }).nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  added_at: z.string().datetime({ offset: true }).nullable().optional(),
  removed_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type JobListingItem = z.infer<typeof JobListingItem>;

export const PricingItem = z.object({
  ...sectionItemBase,
  // Opaque scraper payload — object OR array shape depending on the competitor.
  pricing_data: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullable()
    .optional(),
  changes: z.string().nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  last_updated_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type PricingItem = z.infer<typeof PricingItem>;

export const LinkedInPostItem = z.object({
  ...sectionItemBase,
  url: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  posted_date: z.string().datetime({ offset: true }).nullable().optional(),
});
export type LinkedInPostItem = z.infer<typeof LinkedInPostItem>;

export const YouTubeVideoItem = z.object({
  ...sectionItemBase,
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  posted_date: z.string().datetime({ offset: true }).nullable().optional(),
});
export type YouTubeVideoItem = z.infer<typeof YouTubeVideoItem>;

export const EventItem = z.object({
  ...sectionItemBase,
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  is_virtual: z.boolean().nullable().optional(),
  event_date: z.string().datetime({ offset: true }).nullable().optional(),
});
export type EventItem = z.infer<typeof EventItem>;

export const MessagingItem = z.object({
  ...sectionItemBase,
  message_text: z.string().nullable().optional(),
  message_level: z.string().nullable().optional(),
  order_on_page: z.number().int().nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  added_at: z.string().datetime({ offset: true }).nullable().optional(),
  removed_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type MessagingItem = z.infer<typeof MessagingItem>;

export const MetricsClaimedItem = z.object({
  ...sectionItemBase,
  metric: z.string().nullable().optional(),
  context_brand: z.string().nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  added_at: z.string().datetime({ offset: true }).nullable().optional(),
  removed_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type MetricsClaimedItem = z.infer<typeof MetricsClaimedItem>;

export const LogoItem = z.object({
  ...sectionItemBase,
  name: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  added_at: z.string().datetime({ offset: true }).nullable().optional(),
  removed_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type LogoItem = z.infer<typeof LogoItem>;

export const SitemapUrlItem = z.object({
  ...sectionItemBase,
  url: z.string().nullable().optional(),
});
export type SitemapUrlItem = z.infer<typeof SitemapUrlItem>;

/**
 * Union of every section item shape. The active branch is selected by the
 * envelope's `section` value — not by inspecting properties (several branches
 * overlap on `title`/`url`/`posted_date`). Treated as a permissive union so
 * consumers can round-trip without a discriminator.
 */
export const SectionItem = z.union([
  BlogPostItem,
  JobListingItem,
  PricingItem,
  LinkedInPostItem,
  YouTubeVideoItem,
  EventItem,
  MessagingItem,
  MetricsClaimedItem,
  LogoItem,
  SitemapUrlItem,
]);
export type SectionItem = z.infer<typeof SectionItem>;

// ─── Competitor overview (GET /competitors/{id}) ──────────────────────────

export const CompetitorOverviewItems = z.object({
  "blog-posts": z.array(BlogPostItem),
  "press-posts": z.array(PressPostItem),
  "case-studies": z.array(CaseStudyItem),
  "job-listings": z.array(JobListingItem),
  pricing: z.array(PricingItem),
  messaging: z.array(MessagingItem),
  "metrics-claimed": z.array(MetricsClaimedItem),
  logos: z.array(LogoItem),
  "linkedin-posts": z.array(LinkedInPostItem),
  "youtube-videos": z.array(YouTubeVideoItem),
  events: z.array(EventItem),
});
export type CompetitorOverviewItems = z.infer<typeof CompetitorOverviewItems>;

export const CompetitorOverviewResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    website: z.string(),
    category: z.string().nullable(),
    image_icon: z.string().nullable(),
    created_at: z.string().datetime({ offset: true }),
    social: CompetitorSocial,
    pages: CompetitorPages,
    items: CompetitorOverviewItems,
  }),
});
export type CompetitorOverviewResponse = z.infer<typeof CompetitorOverviewResponse>;

// ─── Activity ─────────────────────────────────────────────────────────────

export const CompetitorRef = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
});
export type CompetitorRef = z.infer<typeof CompetitorRef>;

export const ActivityItem = z.object({
  id: z.string().uuid(),
  section: SectionSlug,
  change_type: ChangeType,
  change_date: z.string().datetime({ offset: true }),
  competitor: CompetitorRef,
  data: SectionItem,
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const ActivityListResponse = z.object({
  data: z.array(ActivityItem),
  pagination: ActivityPagination,
});
export type ActivityListResponse = z.infer<typeof ActivityListResponse>;

export const ActivityDetailResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    section: SectionSlug,
    competitor: CompetitorRef,
    payload: SectionItem,
  }),
});
export type ActivityDetailResponse = z.infer<typeof ActivityDetailResponse>;

// ─── Digests ──────────────────────────────────────────────────────────────

export const DigestSummary = z
  .object({
    executive_summary: z.string().optional(),
    themes: z
      .array(
        z.object({
          title: z.string().optional(),
          bullets: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type DigestSummary = z.infer<typeof DigestSummary>;

export const Digest = z.object({
  id: z.string().uuid(),
  competitor: CompetitorRef,
  period_start: z.string().datetime({ offset: true }).nullable(),
  period_end: z.string().datetime({ offset: true }).nullable(),
  summary: z.union([DigestSummary, z.string(), z.null()]),
  update_count: z.number().int().min(0).nullable(),
  tags: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }),
});
export type Digest = z.infer<typeof Digest>;

export const DigestListResponse = z.object({
  data: z.array(Digest),
  pagination: Pagination,
});
export type DigestListResponse = z.infer<typeof DigestListResponse>;

export const DigestLatestResponse = z.object({
  data: z.array(Digest),
});
export type DigestLatestResponse = z.infer<typeof DigestLatestResponse>;

export const DigestResponse = z.object({
  data: Digest,
});
export type DigestResponse = z.infer<typeof DigestResponse>;

// ─── Me ───────────────────────────────────────────────────────────────────

export const ApiKey = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  key_prefix: z.string().nullable(),
  scopes: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }).nullable(),
  last_used_at: z.string().datetime({ offset: true }).nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const SubscriptionTier = z.enum(["free_trial", "paid"]);
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;

export const SubscriptionStatus = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const Subscription = z.object({
  tier: SubscriptionTier,
  status: SubscriptionStatus,
  competitor_limit: z.number().int().min(0),
  competitors_used: z.number().int().min(0),
  current_period_end: z.string().datetime({ offset: true }).nullable(),
  trial_ends_at: z.string().datetime({ offset: true }).nullable(),
});
export type Subscription = z.infer<typeof Subscription>;

export const RateLimitSnapshot = z.object({
  window_seconds: z.number().int(),
  requests_per_window: z.number().int(),
  remaining_this_instance: z.number().int().min(0),
  reset_at: z.string().datetime({ offset: true }),
});
export type RateLimitSnapshot = z.infer<typeof RateLimitSnapshot>;

export const Workspace = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string().datetime({ offset: true }),
  subscription: Subscription.nullable(),
  rate_limit: RateLimitSnapshot,
});
export type Workspace = z.infer<typeof Workspace>;

export const MeResponse = z.object({
  data: z.object({
    key: ApiKey.nullable(),
    workspace: Workspace.nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;

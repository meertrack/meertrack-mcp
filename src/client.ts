import type {
  ActivityDetailResponse,
  ActivityListResponse,
  ApiErrorCode,
  ChangeType,
  CompetitorDetailListResponse,
  CompetitorListResponse,
  CompetitorOverviewResponse,
  DigestLatestResponse,
  DigestListResponse,
  DigestResponse,
  MeResponse,
  SectionSlug,
} from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.meertrack.com/v1";

/** Resolve the upstream base URL, honoring `MEERTRACK_API_BASE_URL` for staging/local. */
export function resolveBaseUrl(override?: string): string {
  const raw = override ?? process.env["MEERTRACK_API_BASE_URL"] ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export interface MeertrackClientOptions {
  baseUrl?: string;
  apiKey: string;
  /** Test/DI seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional override for the User-Agent suffix (tests). */
  userAgent?: string;
  /**
   * Fired after every upstream response (success or failure) with the parsed
   * `X-Request-Id` header. Used by the HTTP transport to fold the upstream
   * trace ID into the per-request structured log line so a Fly log entry can
   * be cross-referenced against Meertrack backend logs.
   */
  onUpstreamResponse?: (info: {
    status: number;
    requestId: string | null;
  }) => void;
}

/**
 * Typed error thrown for every non-2xx upstream response. `code` reflects the
 * upstream error envelope's `error.code` when present, else a generic fallback
 * (`http_<status>`, `transport_error`, `invalid_response`).
 */
export class MeertrackApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rateLimitReset?: number;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    rateLimitReset?: number;
  }) {
    super(params.message);
    this.name = "MeertrackApiError";
    this.status = params.status;
    this.code = params.code;
    if (params.rateLimitReset !== undefined) {
      this.rateLimitReset = params.rateLimitReset;
    }
  }
}

export interface ListActivityParams {
  competitor_ids?: string[];
  sections?: SectionSlug[];
  change_types?: ChangeType[];
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ListCompetitorsParams {
  active?: boolean;
  ids?: string[];
  expand?: "full";
}

export interface ListDigestsParams {
  competitor_id?: string[];
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Thin typed wrapper over `api.meertrack.com/v1`. Each method is a 1:1 shadow
 * of its endpoint. No retry/backoff in v1 — a 429 throws with the reset
 * epoch and the caller (the MCP tool layer) decides what to tell the agent.
 */
export class MeertrackClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly onUpstreamResponse?: (info: {
    status: number;
    requestId: string | null;
  }) => void;

  constructor(opts: MeertrackClientOptions) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ?? `meertrack-mcp/${VERSION}`;
    if (opts.onUpstreamResponse) {
      this.onUpstreamResponse = opts.onUpstreamResponse;
    }
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/me");
  }

  listCompetitors(
    params: ListCompetitorsParams = {},
  ): Promise<CompetitorListResponse | CompetitorDetailListResponse> {
    const query = new URLSearchParams();
    if (params.active !== undefined) query.set("active", params.active ? "true" : "false");
    if (params.ids && params.ids.length > 0) query.set("id", params.ids.join(","));
    if (params.expand) query.set("expand", params.expand);
    return this.request("GET", "/competitors", query);
  }

  getCompetitor(id: string): Promise<CompetitorOverviewResponse> {
    return this.request<CompetitorOverviewResponse>(
      "GET",
      `/competitors/${encodeURIComponent(id)}`,
    );
  }

  listActivity(params: ListActivityParams = {}): Promise<ActivityListResponse> {
    const query = new URLSearchParams();
    if (params.competitor_ids && params.competitor_ids.length > 0)
      query.set("competitor_id", params.competitor_ids.join(","));
    if (params.sections && params.sections.length > 0)
      query.set("section", params.sections.join(","));
    if (params.change_types && params.change_types.length > 0)
      query.set("change_type", params.change_types.join(","));
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.cursor) query.set("cursor", params.cursor);
    return this.request<ActivityListResponse>("GET", "/activity", query);
  }

  getActivityItem(rowUuid: string): Promise<ActivityDetailResponse> {
    return this.request<ActivityDetailResponse>(
      "GET",
      `/activity/${encodeURIComponent(rowUuid)}`,
    );
  }

  listDigests(params: ListDigestsParams = {}): Promise<DigestListResponse> {
    const query = new URLSearchParams();
    if (params.competitor_id && params.competitor_id.length > 0)
      query.set("competitor_id", params.competitor_id.join(","));
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.cursor) query.set("cursor", params.cursor);
    return this.request<DigestListResponse>("GET", "/digests", query);
  }

  listLatestDigests(): Promise<DigestLatestResponse> {
    return this.request<DigestLatestResponse>("GET", "/digests/latest");
  }

  getDigest(id: string): Promise<DigestResponse> {
    return this.request<DigestResponse>("GET", `/digests/${encodeURIComponent(id)}`);
  }

  private async request<T>(
    method: "GET",
    path: string,
    query?: URLSearchParams,
  ): Promise<T> {
    const qs = query && query.toString().length > 0 ? `?${query.toString()}` : "";
    const url = `${this.baseUrl}${path}${qs}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          "user-agent": this.userAgent,
        },
      });
    } catch (cause) {
      throw new MeertrackApiError({
        status: 0,
        code: "transport_error",
        message:
          cause instanceof Error
            ? `Network error calling Meertrack: ${cause.message}`
            : "Network error calling Meertrack",
      });
    }

    if (this.onUpstreamResponse) {
      this.onUpstreamResponse({
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new MeertrackApiError({
        status: response.status,
        code: "invalid_response",
        message:
          cause instanceof Error
            ? `Malformed JSON from Meertrack: ${cause.message}`
            : "Malformed JSON from Meertrack",
      });
    }
  }
}

/** Parse an upstream non-2xx into a `MeertrackApiError`. Exported for tests. */
export async function toApiError(response: Response): Promise<MeertrackApiError> {
  const resetHeader = response.headers.get("x-ratelimit-reset");
  const rateLimitReset =
    resetHeader && Number.isFinite(Number(resetHeader)) ? Number(resetHeader) : undefined;

  let code: ApiErrorCode | string = `http_${response.status}`;
  let message = response.statusText || `Upstream HTTP ${response.status}`;

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body && typeof body === "object" && body.error) {
      if (typeof body.error.code === "string" && body.error.code.length > 0) {
        code = body.error.code;
      }
      if (typeof body.error.message === "string" && body.error.message.length > 0) {
        message = body.error.message;
      }
    }
  } catch {
    // Upstream returned non-JSON (e.g. a Fly platform error page); keep the
    // HTTP-derived fallback code/message. Never propagate the parse error.
  }

  return new MeertrackApiError({
    status: response.status,
    code,
    message,
    ...(rateLimitReset !== undefined ? { rateLimitReset } : {}),
  });
}

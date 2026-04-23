import { describe, expect, it } from "vitest";
import { MeertrackApiError } from "../src/client.js";
import { toToolError } from "../src/errors.js";

function firstText(result: Awaited<ReturnType<typeof toToolError>>): string {
  expect(result.isError).toBe(true);
  expect(result).not.toHaveProperty("structuredContent");
  const first = result.content[0];
  expect(first).toBeDefined();
  expect(first!.type).toBe("text");
  return (first as { text: string }).text;
}

describe("toToolError — spec Phase 5 mapping", () => {
  it("maps 401 to the mint-a-new-key message and flags isError", () => {
    const err = new MeertrackApiError({
      status: 401,
      code: "unauthorized",
      message: "Missing or invalid API key",
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("Invalid or revoked Meertrack API key");
    expect(text).toContain("Settings → API Keys");
  });

  it("surfaces upstream 403 messages verbatim (competitor_inactive)", () => {
    const err = new MeertrackApiError({
      status: 403,
      code: "competitor_inactive",
      message: 'Competitor "Acme" is deactivated. Reactivate in Settings.',
    });
    const text = firstText(toToolError(err));
    expect(text).toContain('Competitor "Acme" is deactivated');
  });

  it("surfaces forbidden_competitor verbatim", () => {
    const err = new MeertrackApiError({
      status: 403,
      code: "forbidden_competitor",
      message: "That competitor is in a different workspace.",
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("different workspace");
  });

  it("maps 429 with X-RateLimit-Reset to a dual-format retry hint", () => {
    const err = new MeertrackApiError({
      status: 429,
      code: "rate_limited",
      message: "Rate limit exceeded.",
      rateLimitReset: 1745418120,
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("Rate limit exceeded");
    // human-readable ISO
    expect(text).toContain("2025-04-23T14:22:00.000Z");
    // raw epoch
    expect(text).toContain("reset=1745418120");
    expect(text).toContain("Trust X-RateLimit-Reset");
  });

  it("429 without a reset header degrades gracefully", () => {
    const err = new MeertrackApiError({
      status: 429,
      code: "rate_limited",
      message: "Rate limit exceeded.",
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("no reset timestamp");
  });

  it("maps 404 to the workspace-scoped not-found text", () => {
    const err = new MeertrackApiError({
      status: 404,
      code: "not_found",
      message: "row not found",
    });
    const text = firstText(toToolError(err));
    expect(text).toBe("No such row in this workspace.");
  });

  it("maps 5xx to the retry-safe text", () => {
    const err = new MeertrackApiError({
      status: 502,
      code: "http_502",
      message: "bad gateway",
    });
    const text = firstText(toToolError(err));
    expect(text).toBe("Upstream error; safe to retry.");
  });

  it("maps transport errors (status 0) to the retry-safe text", () => {
    const err = new MeertrackApiError({
      status: 0,
      code: "transport_error",
      message: "ENOTFOUND",
    });
    const text = firstText(toToolError(err));
    expect(text).toBe("Upstream error; safe to retry.");
  });

  it("passes through unmapped 4xx with the upstream code", () => {
    const err = new MeertrackApiError({
      status: 422,
      code: "invalid_parameter",
      message: "`from` must be ISO 8601",
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("ISO 8601");
    expect(text).toContain("code=invalid_parameter");
  });

  it("redacts mt_live_ tokens from error message passthrough", () => {
    const err = new MeertrackApiError({
      status: 422,
      code: "invalid_parameter",
      message: "key mt_live_abc123 is invalid",
    });
    const text = firstText(toToolError(err));
    expect(text).toContain("mt_live_***");
    expect(text).not.toContain("mt_live_abc123");
  });

  it("wraps unexpected non-Meertrack errors in a safe message", () => {
    const result = toToolError(new Error("boom mt_live_secret"));
    const text = firstText(result);
    expect(text).toContain("Unexpected error");
    expect(text).toContain("mt_live_***");
    expect(text).not.toContain("mt_live_secret");
  });

  it("never attaches structuredContent on error results", () => {
    const result = toToolError(
      new MeertrackApiError({ status: 429, code: "rate_limited", message: "x", rateLimitReset: 1 }),
    );
    expect(result).not.toHaveProperty("structuredContent");
    expect(result.isError).toBe(true);
  });
});

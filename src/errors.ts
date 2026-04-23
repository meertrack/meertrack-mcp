/**
 * Maps upstream `MeertrackApiError`s into MCP tool-call results per spec
 * §server/tools (isError semantics): upstream REST failures are **tool
 * execution errors**, not protocol errors — the LLM needs to read them and
 * self-correct. They go back as `{ content: [{ type: "text", text }], isError: true }`.
 *
 * Malformed MCP requests (unknown tool, invalid params) are handled by the
 * SDK as JSON-RPC protocol errors (-32601 / -32602) — those never hit this
 * module.
 *
 * Never attach `structuredContent` on `isError: true`: when a tool declares
 * an `outputSchema`, the spec requires `structuredContent` to conform, and
 * error envelopes (e.g. `{ rate_limit_reset }`) don't conform to e.g.
 * `ActivityListResponse`.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MeertrackApiError } from "./client.js";
import { redactApiKeys } from "./auth.js";

/**
 * Narrowed `CallToolResult` for the error branch. `isError: true` per spec,
 * text-only `content`, and no `structuredContent` (the outputSchema doesn't
 * cover error shapes).
 */
export type ToolErrorResult = CallToolResult & { isError: true };

/** Map any error thrown inside a tool handler to an MCP tool-error result. */
export function toToolError(err: unknown): ToolErrorResult {
  if (err instanceof MeertrackApiError) {
    return formatApiError(err);
  }
  // Defensive: a tool handler threw something that wasn't a MeertrackApiError.
  // Don't leak stack traces to the agent — keep the message short and
  // redacted, then return a safe-to-retry-ish generic error.
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
  return errorResult(`Unexpected error: ${redactApiKeys(message)}`);
}

function formatApiError(err: MeertrackApiError): ToolErrorResult {
  const upstream = redactApiKeys(err.message);

  if (err.status === 401) {
    return errorResult(
      "Invalid or revoked Meertrack API key. Mint a new one at Settings → API Keys.",
    );
  }

  if (err.status === 403) {
    // `competitor_inactive` / `forbidden_competitor` messages from upstream
    // are already actionable ("Competitor \"x\" is deactivated. Reactivate…"),
    // so surface them verbatim.
    return errorResult(upstream);
  }

  if (err.status === 404) {
    return errorResult("No such row in this workspace.");
  }

  if (err.status === 429) {
    // Per the OpenAPI contract: trust X-RateLimit-Reset, ignore Remaining.
    // Emit the reset in both human-readable ISO and raw epoch so the agent
    // can parse either form.
    const reset = err.rateLimitReset;
    if (typeof reset === "number" && Number.isFinite(reset)) {
      const iso = new Date(reset * 1000).toISOString();
      return errorResult(
        `${upstream} Retry after ${iso} (reset=${reset}). Trust X-RateLimit-Reset; do not retry sooner.`,
      );
    }
    return errorResult(
      `${upstream} Rate limit hit but no reset timestamp was provided; back off and retry after a minute.`,
    );
  }

  if (err.status >= 500 || err.status === 0) {
    // 0 = transport error (DNS / TCP / TLS). Same surface as 5xx for the agent.
    return errorResult("Upstream error; safe to retry.");
  }

  // 400 / 422 / other 4xx — not specifically mapped. Pass the upstream
  // message through so the agent sees what it got wrong.
  return errorResult(`${upstream} (code=${err.code})`);
}

function errorResult(text: string): ToolErrorResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

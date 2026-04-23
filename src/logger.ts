/**
 * Single-line JSON logger to stderr.
 *
 * Both transports use stderr for diagnostics:
 *   - stdio: stdout is the protocol channel — anything else corrupts framing.
 *   - http : stderr keeps logs out of HTTP responses and lines them up with
 *            `fly logs` (Fly captures both streams; stderr is the convention).
 *
 * Every line is redacted with `redactApiKeys` before write — bearers must
 * never reach disk. Keep the schema additive: consumers parse line-by-line
 * and tolerate extra fields, so adding new keys is non-breaking.
 */

import { redactApiKeys } from "./auth.js";

/** Fields the caller fills in on every log line. */
export interface LogInput {
  /** Logical event name — `http_request`, `stdio_start`, `tool_error`, … */
  event: string;
  /** Optional caller-supplied timestamp; otherwise we set it. */
  ts?: string;
  /** HTTP status code, when applicable. */
  status?: number;
  /** Wall-clock duration in milliseconds. */
  duration_ms?: number;
  /** JSON-RPC method extracted from the request body, if any. */
  mcp_method?: string;
  /** Tool name when `mcp_method === "tools/call"`. */
  tool?: string;
  /** `MCP-Protocol-Version` header from the request. */
  mcp_protocol_version?: string;
  /** Inbound `User-Agent` header. */
  client_user_agent?: string;
  /** Upstream `X-Request-Id`, captured from the Meertrack client when available. */
  meertrack_request_id?: string;
  /** Free-form message for human readers (still redacted). */
  message?: string;
  /** Anything else worth tagging — kept open-ended on purpose. */
  [extra: string]: unknown;
}

export type LogSink = (line: string) => void;

/** Default sink: stderr, newline-terminated. */
export const defaultSink: LogSink = (line) => {
  process.stderr.write(line + "\n");
};

export class Logger {
  private readonly sink: LogSink;

  constructor(sink: LogSink = defaultSink) {
    this.sink = sink;
  }

  log(record: LogInput): void {
    const full: LogInput = {
      ...record,
      ts: record.ts ?? new Date().toISOString(),
    };
    let serialized: string;
    try {
      serialized = JSON.stringify(full);
    } catch {
      // Fall back to a minimal record so a single un-serializable value can't
      // silence logging entirely.
      serialized = JSON.stringify({
        ts: full.ts,
        event: full.event,
        message: "log_serialization_failed",
      });
    }
    this.sink(redactApiKeys(serialized));
  }
}

/** Process-wide default. Tests can construct their own with a custom sink. */
export const logger = new Logger();

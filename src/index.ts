#!/usr/bin/env node
/**
 * Entry point. Routes to stdio or HTTP based on argv/env:
 *
 *   meertrack-mcp              → stdio (default)
 *   meertrack-mcp --http       → HTTP (Streamable)
 *   PORT=8080 meertrack-mcp    → HTTP
 *
 * stdio mode resolves `MEERTRACK_API_KEY` once at startup.
 * HTTP mode resolves bearers per request from the `Authorization` header.
 */

import { resolveEnvApiKey } from "./auth.js";
import { runStdio } from "./transports/stdio.js";
import {
  createHttpApp,
  PRM_PATH,
  defaultProtectedResourceMetadataUrl,
} from "./transports/http.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://cursor.sh",
];

async function main(): Promise<void> {
  const useHttp = process.argv.includes("--http") || process.env["PORT"] !== undefined;

  if (useHttp) {
    await startHttp();
  } else {
    await startStdio();
  }
}

async function startStdio(): Promise<void> {
  // Fail fast with a clear message if the env var is missing or malformed.
  let apiKey: string;
  try {
    apiKey = resolveEnvApiKey();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[meertrack-mcp] ${message}\n`);
    process.exit(1);
  }
  await runStdio({ apiKey });
}

async function startHttp(): Promise<void> {
  // Dynamic import so tests that load `./transports/http` never require
  // `@hono/node-server` to be present.
  const { serve } = await import("@hono/node-server");

  const port = Number(process.env["PORT"] ?? "3000");
  const allowedOrigins = parseAllowedOrigins(
    process.env["MEERTRACK_MCP_ALLOWED_ORIGINS"] ?? DEFAULT_ALLOWED_ORIGINS.join(","),
  );

  // Fly.io sets `FLY_APP_NAME`; on that platform the instance must bind to
  // 0.0.0.0 so the proxy can route traffic in. Local development binds to
  // 127.0.0.1 per MCP spec §transports (DNS rebinding protection).
  const onFly = Boolean(process.env["FLY_APP_NAME"]);
  const hostname = onFly ? "0.0.0.0" : "127.0.0.1";

  const prmUrl =
    process.env["MEERTRACK_MCP_PRM_URL"] ??
    defaultProtectedResourceMetadataUrl(
      process.env["MEERTRACK_MCP_PUBLIC_HOST"] ?? `${hostname}:${port}`,
      onFly ? "https" : "http",
    );

  const baseUrl = process.env["MEERTRACK_API_BASE_URL"];
  const app = createHttpApp({
    allowedOrigins,
    protectedResourceMetadataUrl: prmUrl,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });

  serve({ fetch: app.fetch, port, hostname }, (info) => {
    process.stderr.write(
      `[meertrack-mcp] http listening on http://${info.address}:${info.port} (PRM: ${prmUrl}, origins: ${allowedOrigins.length})\n`,
    );
    process.stderr.write(
      `[meertrack-mcp] routes: POST /mcp, GET ${PRM_PATH}, GET /health\n`,
    );
  });
}

function parseAllowedOrigins(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[meertrack-mcp] fatal: ${message}\n`);
  process.exit(1);
});

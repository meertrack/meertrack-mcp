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
  resourceMetadataFor,
  MCP_PATH,
  defaultProtectedResourceMetadataUrl,
  type CreateHttpAppOptions,
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

  // OAuth 2.1 is opt-in via env. Issuer + audience + JWKS URL must all be set
  // together; partial config is rejected loudly so a misconfigured deploy
  // doesn't silently accept or reject tokens the wrong way.
  const oauthIssuer = process.env["MEERTRACK_OAUTH_ISSUER"];
  const oauthAudience = process.env["MEERTRACK_OAUTH_AUDIENCE"];
  const oauthJwksUrl = process.env["MEERTRACK_OAUTH_JWKS_URL"];
  const oauthAny = oauthIssuer ?? oauthAudience ?? oauthJwksUrl;
  const oauthAll = oauthIssuer && oauthAudience && oauthJwksUrl;
  if (oauthAny && !oauthAll) {
    throw new Error(
      "OAuth env is partially configured. Set all of MEERTRACK_OAUTH_ISSUER, MEERTRACK_OAUTH_AUDIENCE, MEERTRACK_OAUTH_JWKS_URL — or none.",
    );
  }
  const oauth = oauthAll
    ? { issuer: oauthIssuer, audience: oauthAudience, jwksUrl: oauthJwksUrl }
    : undefined;

  const appOptions: CreateHttpAppOptions = {
    allowedOrigins,
    protectedResourceMetadataUrl: prmUrl,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(oauth !== undefined ? { oauth } : {}),
  };

  const metadata = resourceMetadataFor(appOptions);
  if (oauth) warnOnOddAudience(oauth.audience);

  const app = createHttpApp(appOptions);

  serve({ fetch: app.fetch, port, hostname }, (info) => {
    // Log the derived values, not the raw env — these are what go on the wire,
    // and a resource identifier that disagrees with the AS is invisible
    // otherwise until someone fails to connect.
    process.stderr.write(
      `[meertrack-mcp] http listening on http://${info.address}:${info.port} (resource: ${metadata.resource}, PRM: ${metadata.canonicalUrl}, origins: ${allowedOrigins.length})\n`,
    );
    process.stderr.write(
      `[meertrack-mcp] routes: POST ${MCP_PATH}, GET /health, GET ${metadata.paths.join(", GET ")}\n`,
    );
  });
}

/**
 * Warn — never throw — when `MEERTRACK_OAUTH_AUDIENCE` isn't the shape a
 * resource identifier should be (RFC 9728 §1.2: https, no fragment; and for
 * this server its path should be the MCP endpoint).
 *
 * Deliberately non-fatal. This value is only read to build metadata, the
 * `/.well-known/oauth-protected-resource/mcp` route is registered regardless,
 * and turning a cosmetic config oddity into a crash-looping deploy would be a
 * far worse outcome than a slightly wrong document.
 */
function warnOnOddAudience(audience: string): void {
  const warn = (why: string): void => {
    process.stderr.write(
      `[meertrack-mcp] warning: MEERTRACK_OAUTH_AUDIENCE (${audience}) ${why}. Token validation is unaffected; discovery metadata may not match what clients expect.\n`,
    );
  };

  let parsed: URL;
  try {
    parsed = new URL(audience);
  } catch {
    warn("is not a URL, so no path-suffixed metadata route can be derived from it");
    return;
  }
  if (parsed.protocol !== "https:") warn("does not use the https scheme");
  if (parsed.hash) warn("has a fragment, which RFC 9728 §1.2 forbids");
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path !== MCP_PATH) warn(`has path "${parsed.pathname}", expected "${MCP_PATH}"`);
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

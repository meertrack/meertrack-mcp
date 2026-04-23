#!/usr/bin/env node
/**
 * Fails the CI build if `package.json` and `server.json` disagree on version,
 * package identifier, or mcpName — the three fields the MCP Registry uses
 * to verify a publish. `src/server.ts` reads the version from `package.json`
 * at runtime via `createRequire`, so there is no third copy to keep in sync.
 *
 * Usage: `node scripts/check-version-sync.mjs`. Exit 0 on match, 1 on mismatch.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function read(file) {
  return JSON.parse(readFileSync(resolve(repoRoot, file), "utf8"));
}

const pkg = read("package.json");
const server = read("server.json");

const failures = [];

if (server.version !== pkg.version) {
  failures.push(
    `server.json version (${server.version}) does not match package.json version (${pkg.version}).`,
  );
}

if (pkg.mcpName !== server.name) {
  failures.push(
    `package.json mcpName (${pkg.mcpName}) does not match server.json name (${server.name}).`,
  );
}

const npmPackage = (server.packages ?? []).find(
  (p) => p.registryType === "npm" && p.identifier === pkg.name,
);
if (!npmPackage) {
  failures.push(
    `server.json packages[] does not include an npm entry for ${pkg.name}.`,
  );
} else if (npmPackage.version !== pkg.version) {
  failures.push(
    `server.json packages[].version (${npmPackage.version}) does not match package.json version (${pkg.version}).`,
  );
}

if (failures.length > 0) {
  for (const msg of failures) console.error(`✗ ${msg}`);
  console.error("\nUpdate both files together — version skew breaks registry listings.");
  process.exit(1);
}

console.log(`✓ versions in sync at ${pkg.version}`);

#!/usr/bin/env node
/**
 * Fail the release build if `CHANGELOG.md` is missing an entry for the
 * version in `package.json`. Looks for a Keep-a-Changelog-style header line
 *   `## [<version>]` (with or without a trailing date).
 *
 * Used by the publish workflow to keep the npm release notes in sync with
 * what we shipped — Keep-a-Changelog promises a per-version section.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");

const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const header = new RegExp(`^##\\s+\\[${escaped}\\](?:\\s|$)`, "m");

if (!header.test(changelog)) {
  console.error(
    `✗ CHANGELOG.md is missing a section for [${pkg.version}].\n` +
      `  Add "## [${pkg.version}] — YYYY-MM-DD" with the changes shipping in this release.`,
  );
  process.exit(1);
}

console.log(`✓ CHANGELOG.md has an entry for [${pkg.version}]`);

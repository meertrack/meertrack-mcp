#!/usr/bin/env node
/**
 * Print the CHANGELOG.md body for the version in `package.json` — the lines
 * between that version's `## [<version>]` header and the next `## ` header,
 * with surrounding blank lines trimmed. Used by the publish workflow to feed
 * `gh release create --notes-file`, so the GitHub Release notes match the
 * Keep-a-Changelog section we shipped.
 *
 * Usage: `node scripts/extract-changelog.mjs`. Exits 1 if the section is
 * missing (check:changelog should have caught this earlier).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");

const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const header = new RegExp(`^##\\s+\\[${escaped}\\](?:\\s|$)`);

const lines = changelog.split("\n");
const start = lines.findIndex((line) => header.test(line));
if (start === -1) {
  console.error(`✗ CHANGELOG.md is missing a section for [${pkg.version}].`);
  process.exit(1);
}

const body = [];
for (const line of lines.slice(start + 1)) {
  if (/^##\s/.test(line)) break; // next version header ends this section
  body.push(line);
}

process.stdout.write(body.join("\n").trim() + "\n");

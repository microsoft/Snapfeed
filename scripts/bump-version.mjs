#!/usr/bin/env node
/**
 * Bumps the version of all publishable packages in the monorepo.
 *
 * Usage:
 *   node scripts/bump-version.mjs <version>
 *   node scripts/bump-version.mjs 0.2.0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGES = ["packages/client", "packages/server"];

const version = process.argv[2];
if (!version) {
	console.error("Usage: node scripts/bump-version.mjs <version>");
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Invalid semver: ${version}`);
	process.exit(1);
}

for (const pkg of PACKAGES) {
	const path = resolve(pkg, "package.json");
	const json = JSON.parse(readFileSync(path, "utf8"));
	const prev = json.version;
	json.version = version;
	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
	console.log(`${json.name}: ${prev} → ${version}`);
}

console.log("\nDone. Commit, push, then trigger the ESRP pipeline.");

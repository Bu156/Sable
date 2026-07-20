#!/usr/bin/env node
/* oxlint-disable no-console */

// Updates altstore-source.json with a new version entry pointing at a release
// IPA asset, then prints the updated file. Used by .github/workflows/tauri-build.yml.
//
// Usage: update-altstore-source.mjs <source.json> <version> <build> <ipa-size> <downloadURL> <date> [description]
// Env:   none

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const [sourcePath, version, build, sizeStr, downloadURL, date, description] = process.argv.slice(2);

if (!sourcePath || !version || !build || !sizeStr || !downloadURL || !date) {
  console.error(
    'Usage: update-altstore-source.mjs <source.json> <version> <build> <ipa-size> <downloadURL> <date> [description]'
  );
  process.exit(1);
}

const size = Number(sizeStr);
if (!Number.isInteger(size) || size <= 0) {
  console.error(`ipa-size must be a positive integer (got: ${sizeStr})`);
  process.exit(1);
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const app = source.apps?.[0];
if (!app) {
  console.error('Source JSON has no apps[0] to update.');
  process.exit(1);
}

// Strip marketplaceID: SideStore rejects PAL-marked sources.
delete app.marketplaceID;

const entry = {
  version,
  buildVersion: build,
  date,
  size,
  downloadURL,
  localizedDescription: description ?? `v${version}`,
};

// Replace an existing entry for this version, otherwise prepend as latest.
const versions = Array.isArray(app.versions) ? app.versions : [];
const idx = versions.findIndex((v) => v.version === version);
if (idx >= 0) versions[idx] = entry;
else versions.unshift(entry);

// Keep only the most recent 20 versions in the manifest.
app.versions = versions.slice(0, 20);

writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
console.log(
  `Updated ${sourcePath}: ${app.bundleIdentifier} v${version} (${build}) -> ${downloadURL}`
);

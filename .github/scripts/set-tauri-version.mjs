#!/usr/bin/env node
/* oxlint-disable no-console */

// Stamps release-specific settings into src-tauri/tauri.conf.json, which can
// drift from the package.json version Knope tags on. Used by tauri-build.yml.

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const foldNightlyIntoPatch = args.includes('--apple-short-version');
const [version, updaterEndpoint] = args.filter((arg) => !arg.startsWith('--'));
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    `Usage: set-tauri-version.mjs <version> [updater-endpoint] [--apple-short-version]  (got: ${version ?? '<none>'})`
  );
  process.exit(1);
}

if (updaterEndpoint && !updaterEndpoint.startsWith('https://')) {
  console.error(`Updater endpoint must use HTTPS (got: ${updaterEndpoint})`);
  process.exit(1);
}

const file = 'src-tauri/tauri.conf.json';
const config = JSON.parse(readFileSync(file, 'utf8'));

// Sanitize hyphens and leading zeroes in prerelease portion for SemVer 2.0.0 and iOS compatibility
const sanitizedVersion = version.replace(/^(\d+\.\d+\.\d+-nightly)\.(.+)$/, (_, prefix, build) => {
  const sanitizedBuild = build
    .split(/[-.]/)
    .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part))
    .join('.');
  return `${prefix}.${sanitizedBuild}`;
});

// AltStore/SideStore only compare CFBundleShortVersionString, which Tauri fills with
// major.minor.patch, so the nightly stamp has to go in patch to be seen as a new version.
let stampedVersion = sanitizedVersion;
if (foldNightlyIntoPatch) {
  stampedVersion = sanitizedVersion.replace(/^(\d+\.\d+)\.\d+-nightly\.(\d+)$/, '$1.$2');
  if (stampedVersion === sanitizedVersion) {
    console.error(`--apple-short-version needs a nightly version (got: ${sanitizedVersion})`);
    process.exit(1);
  }
}

config.version = stampedVersion;
if (updaterEndpoint) {
  config.plugins.updater.endpoints = [updaterEndpoint];
}
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Set ${file} version to ${stampedVersion}`);
if (updaterEndpoint) console.log(`Set ${file} updater endpoint to ${updaterEndpoint}`);

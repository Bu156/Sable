#!/usr/bin/env node
/* oxlint-disable no-console */

// Stamps a version into src-tauri/tauri.conf.json, which can drift from the
// package.json version Knope tags on. Used by tauri-build.yml.

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Usage: set-tauri-version.mjs <version>  (got: ${version ?? '<none>'})`);
  process.exit(1);
}

const file = 'src-tauri/tauri.conf.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.version = version;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Set ${file} version to ${version}`);

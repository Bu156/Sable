#!/usr/bin/env node
/* oxlint-disable no-console */

import { readFileSync } from 'node:fs';

const runNumber = process.argv[2];
const runAttempt = process.argv[3];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);

if (!match) {
  console.error(`package.json version must be stable SemVer (got: ${packageJson.version})`);
  process.exit(1);
}

if (!/^\d+$/.test(runNumber ?? '') || !/^\d+$/.test(runAttempt ?? '')) {
  console.error('Usage: nightly-version.mjs <run-number> <run-attempt>');
  process.exit(1);
}

const [, major, minor, patch] = match;
console.log(`${major}.${minor}.${Number(patch) + 1}-nightly.${runNumber}.${runAttempt}`);

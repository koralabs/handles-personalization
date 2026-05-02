#!/usr/bin/env node
//
// Persprx hash-stability sentinel.
//
// Reads aiken/plutus.json after `aiken build`, finds the persprx.persprx.spend
// validator, and asserts its hash matches the pinned PERSPRX_HASH below. Trips
// loudly with a non-zero exit code if the hash drifts.
//
// Why: persprx is the spend proxy. Existing handles' LBL_100 reference tokens
// are locked at this script's address forever. A hash change strands every
// LBL_100 at the old address and forces a chain-wide migration.
//
// Triggers for an intentional hash change (require an LBL_100 migration plan):
//   - editing aiken/lib/personalization/proxy_check.ak
//   - editing aiken/validators/persprx.ak
//   - bumping the Aiken compiler or stdlib in aiken.lock
//
// If you bumped the hash on purpose, update PERSPRX_HASH below to the new
// build value and ship the migration plan in the same PR.
//
// Usage:
//   cd handles-personalization && aiken build && node scripts/check-persprx-hash-stable.js

import { readFileSync } from "node:fs";
import path from "node:path";

const PERSPRX_HASH = "7cf105586f77934a524c9e78f8879a33460104f9578e9ac927f577e3";

const repoRoot = path.resolve(import.meta.dirname, "..");
const blueprintPath = path.join(repoRoot, "aiken", "plutus.json");

let blueprint;
try {
    blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
} catch (err) {
    console.error(`Could not read ${blueprintPath}: ${err.message}`);
    console.error(`Run 'cd aiken && aiken build' first.`);
    process.exit(2);
}

const persprx = (blueprint.validators || []).find(
    (v) => v.title === "persprx.persprx.spend"
);
if (!persprx) {
    console.error(
        `persprx.persprx.spend not in ${blueprintPath}. Validators present:`
    );
    for (const v of blueprint.validators || []) console.error(`  - ${v.title}`);
    process.exit(2);
}

if (persprx.hash === PERSPRX_HASH) {
    console.log(`persprx hash OK: ${persprx.hash}`);
    process.exit(0);
}

console.error(`✗ persprx hash drift detected.`);
console.error(`  pinned:   ${PERSPRX_HASH}`);
console.error(`  build:    ${persprx.hash}`);
console.error(``);
console.error(`The proxy spend script is hash-stable by design — its address`);
console.error(`is the lock for every existing handle's LBL_100 reference`);
console.error(`token. If this drift is intentional, write an LBL_100 migration`);
console.error(`plan, update PERSPRX_HASH in this script and the pinned value`);
console.error(`in aiken/lib/personalization/proxy_check.ak, and ship them`);
console.error(`together with the cutover.`);
console.error(``);
console.error(`If this drift is unintentional, look at recent edits in:`);
console.error(`  - aiken/lib/personalization/proxy_check.ak`);
console.error(`  - aiken/validators/persprx.ak`);
console.error(`  - aiken/aiken.lock (compiler / stdlib bumps)`);
process.exit(1);

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/buildMultisigRefScript.js", import.meta.url));

const run = (args = []) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, BLOCKFROST_API_KEY: "" },
  });

test("reference-script builder rejects a missing deployment target", () => {
  // Invariant: operators must select a known contract or an explicit handle/hash pair.
  // Failure caught: an incomplete invocation advances toward transaction construction.
  // Negative control: adding --contract persdsg changes the failure to the API-key requirement.
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: --contract persdsg\|perspz\|perslfc\|persprx/);
});

test("reference-script builder rejects an unknown contract slug", () => {
  // Invariant: only validators named in the deployment map can be selected by slug.
  // Failure caught: a typo silently selects or emits a transaction for the wrong validator.
  // Negative control: replacing unknown with persprx changes the failure to the API-key requirement.
  const result = run(["--contract", "unknown"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: --contract persdsg\|perspz\|perslfc\|persprx/);
});

test("reference-script builder accepts a known contract and defaults to mainnet", () => {
  // Invariant: a valid contract invocation reaches credential validation without extra network flags.
  // Failure caught: argument parsing or the default-network path rejects a supported deployment.
  // Negative control: replacing persdsg with unknown produces the usage error instead.
  const result = run(["--contract", "persdsg"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BLOCKFROST_API_KEY required/);
  assert.doesNotMatch(result.stderr, /usage:|unknown --network/);
});

test("reference-script builder rejects unsupported networks before reading credentials", () => {
  // Invariant: deployments are restricted to Cardano mainnet, preprod, and preview.
  // Failure caught: a misspelled network is used to construct invalid API endpoints.
  // Negative control: replacing staging with preview changes the failure to the API-key requirement.
  const result = run(["--contract", "perspz", "--network", "staging"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown --network staging/);
  assert.doesNotMatch(result.stderr, /BLOCKFROST_API_KEY required/);
});

test("existing-chain mode requires both a handle and script hash", () => {
  // Invariant: reattaching an existing script must identify its exact destination and ledger hash.
  // Failure caught: a partial repair invocation advances without a deterministic source or target.
  // Negative control: supplying both values changes the failure to the API-key requirement.
  const missingHandle = run(["--script-hash", "ab".repeat(28)]);
  assert.notEqual(missingHandle.status, 0);
  assert.match(missingHandle.stderr, /usage: --contract/);

  const complete = run([
    "--handle",
    "persprx2@handlecontract",
    "--script-hash",
    "ab".repeat(28),
  ]);
  assert.notEqual(complete.status, 0);
  assert.match(complete.stderr, /BLOCKFROST_API_KEY required/);
  assert.doesNotMatch(complete.stderr, /usage:/);
});

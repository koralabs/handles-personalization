import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { getAikenArtifactPaths } from "../compileHelpers.js";

const compilePath = path.resolve("./compileAiken.js");

const runCompileModule = async (suffix) => {
  await import(`${pathToFileURL(compilePath).href}?case=${suffix}`);
};

test("getAikenArtifactPaths handles trailing and non-trailing slash", () => {
  const noSlash = getAikenArtifactPaths("./contract");
  const withSlash = getAikenArtifactPaths("./contract/");

  assert.equal(noSlash.directory, "./contract");
  assert.equal(withSlash.directory, "./contract");
  assert.equal(noSlash.blueprint, "./contract/aiken.plutus.json");
  assert.equal(withSlash.blueprint, "./contract/aiken.plutus.json");
  assert.equal(noSlash.addresses, "./contract/aiken.addresses.json");
  assert.equal(noSlash.validators, "./contract/aiken.validators.json");
  assert.equal(noSlash.withdrawHash, "./contract/aiken.withdraw.hash");
});

test("compileAiken.js creates Aiken blueprint artifact", async () => {
  const artifactPaths = getAikenArtifactPaths();
  await runCompileModule("aiken");

  assert.equal(existsSync(artifactPaths.blueprint), true);
  assert.equal(existsSync(artifactPaths.validators), true);
  assert.equal(existsSync(artifactPaths.addresses), true);
  assert.equal(existsSync(artifactPaths.spendHash), true);
  assert.equal(existsSync(artifactPaths.spendAddrTestnet), true);
  assert.equal(existsSync(artifactPaths.spendAddrMainnet), true);
  assert.equal(existsSync(artifactPaths.withdrawHash), true);
  assert.equal(existsSync(artifactPaths.withdrawStakeAddrTestnet), true);
  assert.equal(existsSync(artifactPaths.withdrawStakeAddrMainnet), true);

  const blueprint = JSON.parse(readFileSync(artifactPaths.blueprint, "utf8"));
  const validatorBundle = JSON.parse(readFileSync(artifactPaths.validators, "utf8"));
  const addressBundle = JSON.parse(readFileSync(artifactPaths.addresses, "utf8"));
  const spendHash = readFileSync(artifactPaths.spendHash, "utf8").trim();
  const spendTestnet = readFileSync(artifactPaths.spendAddrTestnet, "utf8").trim();
  const spendMainnet = readFileSync(artifactPaths.spendAddrMainnet, "utf8").trim();
  const withdrawHash = readFileSync(artifactPaths.withdrawHash, "utf8").trim();
  const withdrawStakeTestnet = readFileSync(
    artifactPaths.withdrawStakeAddrTestnet,
    "utf8"
  ).trim();
  const withdrawStakeMainnet = readFileSync(
    artifactPaths.withdrawStakeAddrMainnet,
    "utf8"
  ).trim();

  assert.equal(blueprint.preamble.title, "koralabs/handles-personalization");
  assert.equal(Array.isArray(blueprint.validators), true);
  assert.equal(Array.isArray(validatorBundle.validators), true);
  assert.equal(Array.isArray(addressBundle.validators), true);
  assert.equal(validatorBundle.validators.length > 0, true);
  assert.equal(addressBundle.validators.length > 0, true);

  const titles = validatorBundle.validators.map((entry) => entry.title);
  assert.deepEqual([...titles].sort((a, b) => a.localeCompare(b)), titles);

  const spendEntry = validatorBundle.validators.find((entry) =>
    entry.title.endsWith(".spend")
  );
  assert.ok(spendEntry, "missing .spend validator entry");
  assert.equal(spendEntry.hash, spendHash);
  assert.equal(spendEntry.address_testnet, spendTestnet);
  assert.equal(spendEntry.address_mainnet, spendMainnet);
  assert.equal(spendTestnet.startsWith("addr_test"), true);
  assert.equal(spendMainnet.startsWith("addr1"), true);

  const withdrawEntry = validatorBundle.validators.find((entry) =>
    entry.title.endsWith(".withdraw")
  );
  assert.ok(withdrawEntry, "missing .withdraw validator entry");
  assert.equal(withdrawEntry.hash, withdrawHash);
  assert.equal(withdrawStakeTestnet.startsWith("stake_test1"), true);
  assert.equal(withdrawStakeMainnet.startsWith("stake1"), true);
});

test("personalization validator is wired through observer spend+withdraw flow", () => {
  const validatorSource = readFileSync(
    path.resolve("./aiken/validators/personalization.ak"),
    "utf8"
  );
  const updateSource = readFileSync(
    path.resolve("./aiken/lib/personalization/update.ak"),
    "utf8"
  );
  const typesSource = readFileSync(
    path.resolve("./aiken/lib/personalization/types.ak"),
    "utf8"
  );

  assert.equal(
    validatorSource.includes("update.observer_withdrawal_is_valid("),
    true
  );
  assert.equal(validatorSource.includes("withdraw("), true);
  assert.equal(
    validatorSource.includes("update.dispatch_from_observer("),
    true
  );
  assert.equal(typesSource.includes("pub type ObserverRedeemer"), true);
  assert.equal(
    updateSource.includes("entry.2nd == observer_redeemer_data"),
    true
  );
});

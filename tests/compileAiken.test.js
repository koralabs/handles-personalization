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

  const blueprint = JSON.parse(readFileSync(artifactPaths.blueprint, "utf8"));
  const validatorBundle = JSON.parse(readFileSync(artifactPaths.validators, "utf8"));
  const addressBundle = JSON.parse(readFileSync(artifactPaths.addresses, "utf8"));
  const spendHash = readFileSync(artifactPaths.spendHash, "utf8").trim();
  const spendTestnet = readFileSync(artifactPaths.spendAddrTestnet, "utf8").trim();
  const spendMainnet = readFileSync(artifactPaths.spendAddrMainnet, "utf8").trim();

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
});

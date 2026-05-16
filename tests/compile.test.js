import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  getAikenArtifactPaths,
  getContractArtifactPaths,
  resolveOptimizeFlag,
} from "../compileHelpers.js";

const compilePath = path.resolve("./compile.js");

const runCompileModule = async (suffix) => {
  const previous = process.env.OPTIMIZE;
  delete process.env.OPTIMIZE;

  try {
    await import(`${pathToFileURL(compilePath).href}?case=${suffix}`);
  } finally {
    if (typeof previous === "undefined") delete process.env.OPTIMIZE;
    else process.env.OPTIMIZE = previous;
  }
};

const contractFiles = [
  "./contract/contract.json",
  "./contract/contract.hex",
  "./contract/contract.cbor",
  "./contract/contract.addr",
  "./contract/contract.hash",
  "./contract/contract.uplc",
];

test("resolveOptimizeFlag handles both false and truthy values", () => {
  assert.equal(resolveOptimizeFlag(undefined), false);
  assert.equal(resolveOptimizeFlag("1"), true);
});

test("getContractArtifactPaths handles trailing and non-trailing slash", () => {
  const noSlash = getContractArtifactPaths("./contract");
  const withSlash = getContractArtifactPaths("./contract/");

  assert.equal(noSlash.directory, "./contract");
  assert.equal(withSlash.directory, "./contract");
  assert.equal(noSlash.json, "./contract/contract.json");
  assert.equal(withSlash.uplc, "./contract/contract.uplc");
});

test("getAikenArtifactPaths returns the full Aiken artifact bundle", () => {
  const defaultPaths = getAikenArtifactPaths();
  const withSlash = getAikenArtifactPaths("./contract/");

  assert.deepEqual(defaultPaths, {
    directory: "./contract",
    blueprint: "./contract/aiken.plutus.json",
    validators: "./contract/aiken.validators.json",
    addresses: "./contract/aiken.addresses.json",
    spendHash: "./contract/aiken.spend.hash",
    spendAddrTestnet: "./contract/aiken.spend.addr_testnet",
    spendAddrMainnet: "./contract/aiken.spend.addr_mainnet",
    withdrawHash: "./contract/aiken.withdraw.hash",
    withdrawStakeAddrTestnet: "./contract/aiken.withdraw.stake_addr_testnet",
    withdrawStakeAddrMainnet: "./contract/aiken.withdraw.stake_addr_mainnet",
  });
  assert.equal(withSlash.directory, "./contract");
  assert.equal(withSlash.blueprint, "./contract/aiken.plutus.json");
  assert.equal(withSlash.withdrawStakeAddrMainnet, "./contract/aiken.withdraw.stake_addr_mainnet");
});

test("compile.js creates contract artifacts with optimize disabled", async () => {
  await runCompileModule("disabled");

  for (const file of contractFiles) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }

  const serialized = JSON.parse(readFileSync("./contract/contract.json", "utf8"));
  assert.equal(typeof serialized.cborHex, "string");
  assert.equal(serialized.cborHex.length > 0, true);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  getAikenArtifactPaths,
  PERSONALIZATION_VALIDATOR_SLUGS,
} from "../compileHelpers.js";

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
  assert.equal(
    noSlash.perValidator("pers_proxy").hash,
    "./contract/aiken.pers_proxy.hash"
  );
  assert.equal(
    noSlash.perValidator("pers_logic").compiledCbor,
    "./contract/aiken.pers_logic.compiled.cbor"
  );
});

test("PERSONALIZATION_VALIDATOR_SLUGS is alpha-ordered and stable", () => {
  // Feature: deployment plan ordering depends on a deterministic slug list.
  // Failure mode: a runtime mutation of the slug list would silently swap deploy ordering.
  assert.deepEqual(
    [...PERSONALIZATION_VALIDATOR_SLUGS].sort(),
    PERSONALIZATION_VALIDATOR_SLUGS
  );
});

test("compileAiken.js emits per-validator artifacts for proxy and logic", async () => {
  const artifactPaths = getAikenArtifactPaths();
  await runCompileModule("aiken");

  assert.equal(existsSync(artifactPaths.blueprint), true);
  assert.equal(existsSync(artifactPaths.validators), true);
  assert.equal(existsSync(artifactPaths.addresses), true);

  for (const slug of PERSONALIZATION_VALIDATOR_SLUGS) {
    const paths = artifactPaths.perValidator(slug);
    assert.equal(existsSync(paths.hash), true, `missing ${paths.hash}`);
    assert.equal(existsSync(paths.addrTestnet), true, `missing ${paths.addrTestnet}`);
    assert.equal(existsSync(paths.addrMainnet), true, `missing ${paths.addrMainnet}`);
    assert.equal(existsSync(paths.compiledCbor), true, `missing ${paths.compiledCbor}`);
  }

  const blueprint = JSON.parse(readFileSync(artifactPaths.blueprint, "utf8"));
  const validatorBundle = JSON.parse(readFileSync(artifactPaths.validators, "utf8"));
  const addressBundle = JSON.parse(readFileSync(artifactPaths.addresses, "utf8"));

  assert.equal(blueprint.preamble.title, "koralabs/handles-personalization");
  assert.equal(Array.isArray(validatorBundle.validators), true);
  assert.equal(validatorBundle.validators.length, 2, "expected proxy + logic entries");
  const slugs = validatorBundle.validators.map((entry) => entry.slug).sort();
  assert.deepEqual(slugs, ["pers_logic", "pers_proxy"]);

  const proxy = validatorBundle.validators.find((entry) => entry.slug === "pers_proxy");
  const logic = validatorBundle.validators.find((entry) => entry.slug === "pers_logic");
  assert.notEqual(proxy.hash, logic.hash, "proxy and logic must have distinct script hashes");
  assert.ok(proxy.handlers.includes("spend"), "proxy must expose a spend handler");
  assert.ok(logic.handlers.includes("withdraw"), "logic must expose a withdraw handler");

  // Per-file hashes match the bundle entries.
  const proxyHash = readFileSync(artifactPaths.perValidator("pers_proxy").hash, "utf8").trim();
  const logicHash = readFileSync(artifactPaths.perValidator("pers_logic").hash, "utf8").trim();
  assert.equal(proxyHash, proxy.hash);
  assert.equal(logicHash, logic.hash);

  // Logic validator (withdraw) must have stake addresses written too.
  const logicPaths = artifactPaths.perValidator("pers_logic");
  assert.equal(existsSync(logicPaths.stakeAddrTestnet), true);
  assert.equal(existsSync(logicPaths.stakeAddrMainnet), true);
  const logicStakeTestnet = readFileSync(logicPaths.stakeAddrTestnet, "utf8").trim();
  const logicStakeMainnet = readFileSync(logicPaths.stakeAddrMainnet, "utf8").trim();
  assert.equal(logicStakeTestnet.startsWith("stake_test1"), true);
  assert.equal(logicStakeMainnet.startsWith("stake1"), true);

  // Proxy validator (spend-only) should not have stake addresses.
  const proxyPaths = artifactPaths.perValidator("pers_proxy");
  assert.equal(existsSync(proxyPaths.stakeAddrTestnet), false);
  assert.equal(existsSync(proxyPaths.stakeAddrMainnet), false);

  assert.equal(addressBundle.validators.length, 2);
});

test("personalization is wired as proxy (spend) + logic (withdraw_0) split", () => {
  // Feature: the proxy validator delegates to a withdraw_0 from any of pz_settings.valid_contracts.
  // Failure mode: a regression that re-merges spend+withdraw into one validator would silently turn into a single-script deployment again.
  const proxySource = readFileSync(
    path.resolve("./aiken/validators/pers_proxy.ak"),
    "utf8"
  );
  const logicSource = readFileSync(
    path.resolve("./aiken/validators/pers_logic.ak"),
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

  assert.ok(
    proxySource.includes("update.observer_withdrawal_is_valid("),
    "proxy must delegate to update.observer_withdrawal_is_valid"
  );
  assert.ok(!proxySource.includes("withdraw("), "proxy file must not declare a withdraw handler");
  assert.ok(
    logicSource.includes("update.dispatch_from_observer("),
    "logic must call update.dispatch_from_observer"
  );
  assert.ok(!logicSource.includes("spend("), "logic file must not declare a spend handler");
  assert.ok(typesSource.includes("pub type ObserverRedeemer"));
  assert.ok(updateSource.includes("entry.2nd == observer_redeemer_data"));
});

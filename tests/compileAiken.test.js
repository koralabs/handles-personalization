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
    noSlash.perValidator("persprx").hash,
    "./contract/aiken.persprx.hash"
  );
  assert.equal(
    noSlash.perValidator("perspz").compiledCbor,
    "./contract/aiken.perspz.compiled.cbor"
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

test("PERSONALIZATION_VALIDATOR_SLUGS includes the 4 expected validators", () => {
  // persdsg must deploy first (perspz hardcodes its hash via persdsg_hash).
  // alpha order: persdsg, perslfc, persprx, perspz.
  assert.deepEqual(PERSONALIZATION_VALIDATOR_SLUGS, [
    "persdsg",
    "perslfc",
    "persprx",
    "perspz",
  ]);
});

test("compileAiken.js emits per-validator artifacts for all 4 validators", async () => {
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
  assert.equal(
    validatorBundle.validators.length,
    4,
    "expected persdsg + perslfc + persprx + perspz entries"
  );
  const slugs = validatorBundle.validators.map((entry) => entry.slug).sort();
  assert.deepEqual(slugs, ["persdsg", "perslfc", "persprx", "perspz"]);

  // All 4 hashes must be distinct (each validator is its own script).
  const hashes = new Set(validatorBundle.validators.map((entry) => entry.hash));
  assert.equal(hashes.size, 4, "all 4 validators must have distinct script hashes");

  // Handler shape: persprx is the spend proxy; perspz/perslfc/persdsg are withdraw observers.
  const persprx = validatorBundle.validators.find((e) => e.slug === "persprx");
  const perspz = validatorBundle.validators.find((e) => e.slug === "perspz");
  const perslfc = validatorBundle.validators.find((e) => e.slug === "perslfc");
  const persdsg = validatorBundle.validators.find((e) => e.slug === "persdsg");
  assert.ok(persprx.handlers.includes("spend"), "persprx must expose a spend handler");
  assert.ok(perspz.handlers.includes("withdraw"), "perspz must expose a withdraw handler");
  assert.ok(perslfc.handlers.includes("withdraw"), "perslfc must expose a withdraw handler");
  assert.ok(persdsg.handlers.includes("withdraw"), "persdsg must expose a withdraw handler");

  // Per-file hashes match the bundle entries.
  for (const slug of PERSONALIZATION_VALIDATOR_SLUGS) {
    const entry = validatorBundle.validators.find((e) => e.slug === slug);
    const fileHash = readFileSync(artifactPaths.perValidator(slug).hash, "utf8").trim();
    assert.equal(fileHash, entry.hash, `${slug} hash file must match validator bundle`);
  }

  // Withdraw observers must have stake addresses written too.
  for (const slug of ["persdsg", "perslfc", "perspz"]) {
    const paths = artifactPaths.perValidator(slug);
    assert.equal(existsSync(paths.stakeAddrTestnet), true, `missing ${paths.stakeAddrTestnet}`);
    assert.equal(existsSync(paths.stakeAddrMainnet), true, `missing ${paths.stakeAddrMainnet}`);
    const stakeTestnet = readFileSync(paths.stakeAddrTestnet, "utf8").trim();
    const stakeMainnet = readFileSync(paths.stakeAddrMainnet, "utf8").trim();
    assert.equal(stakeTestnet.startsWith("stake_test1"), true);
    assert.equal(stakeMainnet.startsWith("stake1"), true);
  }

  // persprx (spend-only) should not have stake addresses.
  const persprxPaths = artifactPaths.perValidator("persprx");
  assert.equal(existsSync(persprxPaths.stakeAddrTestnet), false);
  assert.equal(existsSync(persprxPaths.stakeAddrMainnet), false);

  assert.equal(addressBundle.validators.length, 4);
});

test("personalization is wired as persprx (spend) + 3 withdraw observers (perspz/perslfc/persdsg)", () => {
  // Feature: persprx is the spend proxy that delegates to a withdraw_0 from any
  // of pz_settings.valid_contracts. perspz/perslfc are the actual observers
  // that handle Personalize / other redeemers respectively. persdsg is a
  // SECOND withdraw observer required by perspz for non-reset Personalize txs;
  // it validates designer_settings (split out for size).
  // Failure mode: a regression that re-merges spend+withdraw or removes the
  // persdsg gate would silently change the deployment topology.
  const persprxSource = readFileSync(
    path.resolve("./aiken/validators/persprx.ak"),
    "utf8"
  );
  const perspzSource = readFileSync(
    path.resolve("./aiken/validators/perspz.ak"),
    "utf8"
  );
  const perslfcSource = readFileSync(
    path.resolve("./aiken/validators/perslfc.ak"),
    "utf8"
  );
  const persdsgSource = readFileSync(
    path.resolve("./aiken/validators/persdsg.ak"),
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

  // persprx is a spend validator that delegates to observer_withdrawal_is_valid_data.
  assert.ok(
    persprxSource.includes("update.observer_withdrawal_is_valid_data("),
    "persprx must delegate to update.observer_withdrawal_is_valid_data"
  );
  assert.ok(
    !persprxSource.includes("withdraw("),
    "persprx file must not declare a withdraw handler"
  );

  // perspz is a withdraw observer for the Personalize redeemer.
  assert.ok(
    perspzSource.includes("update.validate_observer_personalize("),
    "perspz must call update.validate_observer_personalize"
  );
  assert.ok(!perspzSource.includes("spend("), "perspz must not declare a spend handler");

  // perslfc is a withdraw observer for the lifecycle redeemers.
  assert.ok(
    perslfcSource.includes("update.validate_observer_other("),
    "perslfc must call update.validate_observer_other"
  );
  assert.ok(!perslfcSource.includes("spend("), "perslfc must not declare a spend handler");

  // persdsg is a withdraw observer for designer_settings validation.
  assert.ok(
    persdsgSource.includes("update.validate_observer_designer_settings("),
    "persdsg must call update.validate_observer_designer_settings"
  );
  assert.ok(!persdsgSource.includes("spend("), "persdsg must not declare a spend handler");

  // Type-level wiring + perspz's persdsg gate.
  assert.ok(typesSource.includes("pub type ObserverRedeemer"));
  assert.ok(updateSource.includes("entry.2nd == observer_redeemer_data"));
  assert.ok(
    updateSource.includes("persdsg_observed_for_personalize"),
    "perspz must check persdsg observed for non-reset Personalize"
  );
  assert.ok(
    /const persdsg_hash:\s*ByteArray/.test(updateSource),
    "update.ak must hardcode persdsg_hash"
  );
});

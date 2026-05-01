import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadDesiredDeploymentState,
  parseDesiredDeploymentState,
} from "../deploymentState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("loads the preview desired deployment YAML fixture into the normalized shape", async () => {
  // Feature: desired deployment state stores decoded comparable personalization settings plus assigned Handles for each contract.
  // Failure mode: planner/runtime code would diff against raw CBOR blobs or lose the live handle bindings needed for deployment tracking.
  const fixturePath = path.resolve(__dirname, "../deploy/preview/personalization.yaml");

  const state = await loadDesiredDeploymentState(fixturePath);

  assert.equal(state.schemaVersion, 3);
  assert.equal(state.network, "preview");
  assert.equal(state.subhandleStrategy.namespace, "handlecontract");
  // Current architecture: persdsg + perslfc + persprx + perspz (4 validators).
  // persprx is the spend proxy (with old_script_type "pz"); perspz/perslfc/persdsg
  // are withdraw observers. persdsg must deploy before perspz.
  assert.equal(state.contracts.length, 4);
  const slugs = state.contracts.map((c) => c.contractSlug);
  assert.deepEqual(slugs, ["persdsg", "perslfc", "persprx", "perspz"]);
  const persdsgContract = state.contracts.find((c) => c.contractSlug === "persdsg");
  const perslfcContract = state.contracts.find((c) => c.contractSlug === "perslfc");
  const persprxContract = state.contracts.find((c) => c.contractSlug === "persprx");
  const perspzContract = state.contracts.find((c) => c.contractSlug === "perspz");
  assert.equal(persprxContract.oldScriptType, "pz");
  assert.equal(persdsgContract.oldScriptType, null);
  assert.equal(perslfcContract.oldScriptType, null);
  assert.equal(perspzContract.oldScriptType, null);
  assert.equal(persdsgContract.build.target, "aiken/validators/persdsg.ak");
  assert.equal(perslfcContract.build.target, "aiken/validators/perslfc.ak");
  assert.equal(persprxContract.build.target, "aiken/validators/persprx.ak");
  assert.equal(perspzContract.build.target, "aiken/validators/perspz.ak");
  assert.deepEqual(state.assignedHandles.settings, ["pers@handle_settings", "pers_bg@handle_settings", "pers_pfp@handle_settings"]);
  assert.deepEqual(state.assignedHandles.scripts, ["pz_contract_06"]);
  assert.equal(state.settings.values["pers@handle_settings"].treasury_fee, 1500000);
  assert.equal(state.settings.values["pers@handle_settings"].settings_cred, "688edc94904c5286ac5cc0ada61b9c847a8d23018829832e0e95b111");
  assert.equal(state.settings.values["pers@handle_settings"].pz_providers["4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1"], "195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66");
  assert.equal(state.settings.values["pers@handle_settings"].valid_contracts.at(-1), "8585b4892cec81880ed30d7e80fb0ffbe15c5224b76d2cc4e3dd040d");
});

test("loads the preprod and mainnet desired deployment YAML fixtures", async () => {
  // Feature: rollout coverage includes committed desired-state inputs for all intended personalization networks.
  // Failure mode: workflow push/PR runs would silently skip a network or compare against stale schema fixtures.
  const preprod = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preprod/personalization.yaml")
  );
  const mainnet = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/mainnet/personalization.yaml")
  );

  assert.equal(preprod.network, "preprod");
  assert.equal(mainnet.network, "mainnet");
  assert.equal(preprod.contracts.length, 4);
  assert.equal(mainnet.contracts.length, 4);
  assert.equal(preprod.assignedHandles.scripts[0], "pz_contract_06");
  assert.equal(mainnet.assignedHandles.scripts[0], "pz_contract_04");
  assert.equal(preprod.settings.values["pers@handle_settings"].settings_cred, "e0a2120c0968393f54e9fda8e277ed61e322ff0581713f62335b2b4c");
  assert.equal(mainnet.settings.values["pers@handle_settings"].settings_cred, "7e3a48aff0ddfadec229d13fe4ec544ff3cc4f044629d4e31e8359f0");
});

test("rejects observed-only live fields inside desired deployment YAML", () => {
  // Feature: desired deployment YAML excludes volatile live chain fields.
  // Failure mode: bootstrap/live snapshots could be committed directly and create unstable drift plans.
  assert.throws(
    () =>
      parseDesiredDeploymentState(
        `
schema_version: 3
network: preview
current_script_hash: deadbeef
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
contracts:
  - contract_slug: pers_proxy
    script_type: pers_proxy
    old_script_type: null
    deployment_handle_slug: pers_proxy
    build:
      target: aiken/validators/pers_proxy.ak
      kind: validator
      parameters: {}
assigned_handles:
  settings: [pers@handle_settings, pers_bg@handle_settings, pers_pfp@handle_settings]
  scripts: [pz_contract_06]
ignored_settings: []
settings:
  type: personalization_settings
  values:
    pers@handle_settings:
      treasury_fee: 1
      treasury_cred: aa
      pz_min_fee: 2
      pz_providers: {}
      valid_contracts: []
      admin_creds: []
      settings_cred: bb
      grace_period: 3
      subhandle_share_percent: 4
        `,
        "invalid fixture"
      ),
    /must not include observed-only field `current_script_hash`/
  );
});

test("rejects deployment handle slugs longer than 10 characters", () => {
  // Feature: new deployment handle namespaces must fit the 10-character slug rule for future ordinal allocation.
  // Failure mode: repo YAML would accept invalid slugs that cannot produce valid handle names.
  assert.throws(
    () =>
      parseDesiredDeploymentState(
        `
schema_version: 3
network: preview
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
contracts:
  - contract_slug: personalization
    script_type: personalization
    old_script_type: null
    deployment_handle_slug: personalization
    build:
      target: aiken/validators/pers_proxy.ak
      kind: validator
      parameters: {}
assigned_handles:
  settings: [pers@handle_settings, pers_bg@handle_settings, pers_pfp@handle_settings]
  scripts: [pz_contract_06]
ignored_settings: []
settings:
  type: personalization_settings
  values:
    pers@handle_settings:
      treasury_fee: 1
      treasury_cred: aa
      pz_min_fee: 2
      pz_providers: {}
      valid_contracts: []
      admin_creds: []
      settings_cred: bb
      grace_period: 3
      subhandle_share_percent: 4
        `,
        "invalid fixture"
      ),
    /must be 10 characters or fewer/
  );
});

test("rejects duplicate contract_slug entries", () => {
  assert.throws(
    () =>
      parseDesiredDeploymentState(
        `
schema_version: 3
network: preview
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
contracts:
  - contract_slug: pers_proxy
    script_type: pers_proxy
    old_script_type: null
    deployment_handle_slug: pers_proxy
    build:
      target: aiken/validators/pers_proxy.ak
      kind: validator
      parameters: {}
  - contract_slug: pers_proxy
    script_type: pers_proxy
    old_script_type: null
    deployment_handle_slug: pers_proxy
    build:
      target: aiken/validators/pers_proxy.ak
      kind: validator
      parameters: {}
assigned_handles:
  settings: [pers@handle_settings]
  scripts: []
ignored_settings: []
settings:
  type: personalization_settings
  values:
    pers@handle_settings:
      treasury_fee: 1
      treasury_cred: aa
      pz_min_fee: 2
      pz_providers: {}
      valid_contracts: []
      admin_creds: []
      settings_cred: bb
      grace_period: 3
      subhandle_share_percent: 4
        `,
        "duplicate slug fixture"
      ),
    /unique contract_slug/
  );
});

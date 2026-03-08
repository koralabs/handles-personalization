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
  // Feature: desired deployment state comes from committed YAML with exact personalization settings datums.
  // Failure mode: planner/runtime code would diff against malformed settings or miss one of the required handles.
  const fixturePath = path.resolve(__dirname, "../deploy/preview/personalization.yaml");

  const state = await loadDesiredDeploymentState(fixturePath);

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.network, "preview");
  assert.equal(state.contractSlug, "personalization");
  assert.deepEqual(Object.keys(state.settings.values), [
    "bg_policy_ids",
    "pfp_policy_ids",
    "pz_settings",
  ]);
  assert.equal(state.settings.values.bg_policy_ids.startsWith("a5581c8ed30c080a"), true);
  assert.equal(state.settings.values.pz_settings.endsWith("1832ff"), true);
});

test("loads the preprod and mainnet desired deployment YAML fixtures", async () => {
  // Feature: rollout coverage includes committed desired-state inputs for all intended personalization networks.
  // Failure mode: workflow push/PR runs would silently skip a network because the repo never committed its YAML.
  const preprod = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preprod/personalization.yaml")
  );
  const mainnet = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/mainnet/personalization.yaml")
  );

  assert.equal(preprod.network, "preprod");
  assert.equal(mainnet.network, "mainnet");
  assert.equal(preprod.settings.values.pz_settings.endsWith("1832ff"), true);
  assert.equal(mainnet.settings.values.pz_settings.endsWith("1832ff"), true);
});

test("rejects observed-only live fields inside desired deployment YAML", () => {
  // Feature: desired deployment YAML excludes volatile live chain fields.
  // Failure mode: bootstrap/live snapshots could be committed directly and create unstable drift plans.
  assert.throws(
    () =>
      parseDesiredDeploymentState(
        `
schema_version: 1
network: preview
contract_slug: personalization
build:
  target: aiken/validators/personalization.ak
  kind: validator
  parameters: {}
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
current_script_hash: deadbeef
settings:
  type: personalization_settings
  values:
    bg_policy_ids: aa
    pfp_policy_ids: bb
    pz_settings: cc
        `,
        "invalid fixture"
      ),
    /must not include observed-only field `current_script_hash`/
  );
});

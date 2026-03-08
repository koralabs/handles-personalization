import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildExpectedPersonalizationScriptHash,
  buildPersonalizationDeploymentPlan,
  decodePzSettingsDatum,
  discoverNextContractSubhandle,
  fetchLivePersonalizationDeploymentState,
} from "../deploymentPlan.js";

const desiredState = {
  schemaVersion: 2,
  network: "preview",
  contractSlug: "pers",
  scriptType: "pers",
  oldScriptType: null,
  deploymentHandleSlug: "pers",
  build: {
    target: "aiken/validators/pers.ak",
    kind: "validator",
    parameters: {},
  },
  subhandleStrategy: {
    namespace: "handlecontract",
    format: "contract_slug_ordinal",
  },
  assignedHandles: {
    settings: ["pz_settings", "bg_policy_ids", "pfp_policy_ids"],
    scripts: ["pz_contract_06"],
  },
  ignoredSettings: [],
  settings: {
    type: "personalization_settings",
    values: {
      pz_settings: {
        treasury_fee: 1500000,
        treasury_cred: "195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66",
        pz_min_fee: 1500000,
        pz_providers: {
          "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1": "195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66",
          "eb0a80e0dc6bc3cd5e95c249e02b0fe23f05ec039e754368a6f0e223": "195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66",
        },
        valid_contracts: ["3ac54dace81eb69b2c974a1db2b89f2529fbf4da97c482decb32b6a5"],
        admin_creds: ["151a82d0669a20bd77de1296eee5ef1259ce98ecd81bd7121825f9eb"],
        settings_cred: "300b1c7993d1e2f33007ca24a00c977d9b187d57e77e0b8fc6b344b8",
        grace_period: 3600000,
        subhandle_share_percent: 50,
      },
    },
  },
};

const previewDatum = "9f1a0016e360581c195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d661a0016e360a2581ceb0a80e0dc6bc3cd5e95c249e02b0fe23f05ec039e754368a6f0e223581c195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66581c4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1581c195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d669f581c3ac54dace81eb69b2c974a1db2b89f2529fbf4da97c482decb32b6a5ff9f581c151a82d0669a20bd77de1296eee5ef1259ce98ecd81bd7121825f9ebff581c300b1c7993d1e2f33007ca24a00c977d9b187d57e77e0b8fc6b344b81a0036ee801832ff";

test("expected script hash is read from the compileAiken output artifact", () => {
  // Feature: deployment planning derives the expected personalization script hash from repo-native compile artifacts.
  // Failure mode: artifact plans could diff against a stale hardcoded hash instead of the built contract.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-hash-"));
  const spendHashPath = path.join(tempDir, "aiken.spend.hash");
  let compiled = 0;
  const hash = buildExpectedPersonalizationScriptHash({
    compileFn: () => {
      compiled += 1;
      fs.writeFileSync(spendHashPath, "ab".repeat(28));
    },
    spendHashPath,
  });

  assert.equal(hash, "ab".repeat(28));
  assert.equal(compiled, 1);
});

test("decodes pz_settings CBOR into named YAML fields", () => {
  // Feature: comparable personalization settings are stored and compared as named YAML fields instead of raw CBOR.
  // Failure mode: live-vs-desired comparison would stay opaque and brittle around provider-map keys.
  const decoded = decodePzSettingsDatum(previewDatum);

  assert.equal(decoded.treasury_fee, 1500000);
  assert.equal(decoded.pz_providers["4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1"], "195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66");
  assert.equal(decoded.settings_cred, "300b1c7993d1e2f33007ca24a00c977d9b187d57e77e0b8fc6b344b8");
});

test("fetches live personalization deployment state from the Handles API", async () => {
  // Feature: the planner reads the deployed personalization script, assigned settings handles, and decoded comparable settings.
  // Failure mode: workflow artifacts would diff against incomplete live state or raw datum blobs.
  const requests = [];
  const live = await fetchLivePersonalizationDeploymentState({
    network: "preview",
    oldScriptType: desiredState.oldScriptType,
    userAgent: "codex-test",
    fetchFn: async (url, init) => {
      requests.push({ url: String(url), headers: init?.headers });
      const text = String(url);
      if (text.endsWith("/scripts?latest=true")) {
        return new Response(
          JSON.stringify({
            validatorHash: "ab".repeat(28),
            handle: "pz_contract_06",
          }),
          { status: 200 }
        );
      }
      if (text.endsWith("pz_settings/datum")) {
        return new Response(previewDatum, { status: 200 });
      }
      return new Response(JSON.stringify({ utxo: "tx#0" }), { status: 200 });
    },
  });

  assert.equal(live.currentScriptHash, "ab".repeat(28));
  assert.equal(live.currentSubhandle, "pz_contract_06");
  assert.deepEqual(live.currentSettingsUtxoRefs, {
    bg_policy_ids: "tx#0",
    pfp_policy_ids: "tx#0",
    pz_settings: "tx#0",
  });
  assert.equal(live.settings.pz_settings.treasury_fee, 1500000);
  assert.equal(requests[0].url, "https://preview.api.handle.me/scripts?latest=true");
});

test("builds a no-change deployment plan when the live script and settings match", () => {
  // Feature: push/PR planning should not request a deployment when personalization live state already matches committed YAML.
  // Failure mode: ops would get false-positive deployment plans for a clean network.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "ab".repeat(28),
      currentSubhandle: "pz_contract_06",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.driftType, "no_change");
  assert.deepEqual(plan.summaryJson.transaction_order, []);
  assert.match(plan.summaryMarkdown, /No settings changes/);
  assert.deepEqual(plan.summaryJson.contracts[0].expected_post_deploy_state.assigned_handles.settings, ["pz_settings", "bg_policy_ids", "pfp_policy_ids"]);
});

test("builds a script-and-settings deployment plan when both drift", () => {
  // Feature: deployment planning must report both contract drift and settings drift when personalization changes on both surfaces.
  // Failure mode: operators would sign a plan without seeing the decoded settings change or the newly allocated handle.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "pz_contract_06",
      settings: {
        pz_settings: {
          ...desiredState.settings.values.pz_settings,
          subhandle_share_percent: 40,
        },
      },
    },
    nextSubhandle: "pers7@handlecontract",
  });

  assert.equal(plan.driftType, "script_hash_and_settings");
  assert.equal(plan.summaryJson.contracts[0].settings.diff_rows[0].handle_name, "pz_settings");
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, "pers7@handlecontract");
});

test("marks script drift for manual review when no replacement handle is resolved", () => {
  // Feature: the first-pass workflow can still emit honest artifacts when the repo's live deployment handle namespace is not auto-allocatable yet.
  // Failure mode: planning would fail outright on script drift instead of producing a review-required artifact bundle.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "pz_contract_06",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.summaryJson.contracts[0].subhandle.action, "manual_review");
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, "pz_contract_06");
  assert.match(plan.summaryMarkdown, /operator review/i);
});

test("discovers the next available personalization SubHandle ordinal from the short deployment slug", async () => {
  // Feature: script-hash deployments allocate the next free <deployment_handle_slug><ordinal>@handlecontract name.
  // Failure mode: a generated plan could exceed the 10-character slug rule or collide with an existing handle.
  const requested = [];
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    deploymentHandleSlug: "pers",
    namespace: "handlecontract",
    currentSubhandle: "pers2@handlecontract",
    userAgent: "codex-test",
    fetchFn: async (url) => {
      requested.push(String(url));
      return new Response("{}", {
        status: String(url).endsWith("pers4%40handlecontract") ? 404 : 200,
      });
    },
  });

  assert.equal(subhandle, "pers3@handlecontract");
  assert.deepEqual(requested, [
    "https://preview.api.handle.me/handles/pers1%40handlecontract",
    "https://preview.api.handle.me/handles/pers2%40handlecontract",
    "https://preview.api.handle.me/handles/pers3%40handlecontract",
    "https://preview.api.handle.me/handles/pers4%40handlecontract",
  ]);
});

test("reuses an already minted personalization replacement handle", async () => {
  // Feature: planner reruns should keep the first minted replacement ordinal instead of allocating a newer one.
  // Failure mode: repeated workflow runs would create extra `@handlecontract` sessions before any deployment is signed.
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    deploymentHandleSlug: "pers",
    namespace: "handlecontract",
    currentSubhandle: "pz_contract_06",
    userAgent: "codex-test",
    fetchFn: async (url) => new Response("{}", {
      status: String(url).endsWith("pers2%40handlecontract") ? 404 : 200,
    }),
  });

  assert.equal(subhandle, "pers1@handlecontract");
});

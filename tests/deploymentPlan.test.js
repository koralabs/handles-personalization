import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildExpectedPersonalizationScriptHash,
  buildPersonalizationDeploymentPlan,
  discoverNextContractSubhandle,
  fetchLivePersonalizationDeploymentState,
} from "../deploymentPlan.js";

const desiredState = {
  schemaVersion: 1,
  network: "preview",
  contractSlug: "personalization",
  build: {
    target: "aiken/validators/personalization.ak",
    kind: "validator",
    parameters: {},
  },
  subhandleStrategy: {
    namespace: "handlecontract",
    format: "contract_slug_ordinal",
  },
  settings: {
    type: "personalization_settings",
    values: {
      bg_policy_ids: "aa",
      pfp_policy_ids: "bb",
      pz_settings: "cc",
    },
  },
};

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

test("fetches live personalization deployment state from the Handles API", async () => {
  // Feature: the planner reads the deployed personalization script plus the three settings handles from the network-specific Handles API.
  // Failure mode: workflow artifacts would diff against incomplete live state and miss settings drift.
  const requests = [];
  const live = await fetchLivePersonalizationDeploymentState({
    network: "preview",
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
      if (text.endsWith("/datum")) {
        return new Response(text.includes("bg_policy_ids") ? "aa" : text.includes("pfp_policy_ids") ? "bb" : "cc", {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ utxo: "tx#0" }), { status: 200 });
    },
  });

  assert.equal(live.currentScriptHash, "ab".repeat(28));
  assert.equal(live.currentSubhandle, "pz_contract_06");
  assert.deepEqual(live.settings, {
    bg_policy_ids: "aa",
    pfp_policy_ids: "bb",
    pz_settings: "cc",
  });
  assert.deepEqual(live.currentSettingsUtxoRefs, {
    bg_policy_ids: "tx#0",
    pfp_policy_ids: "tx#0",
    pz_settings: "tx#0",
  });
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
});

test("builds a script-and-settings deployment plan when both drift", () => {
  // Feature: deployment planning must report both contract drift and settings drift when personalization changes on both surfaces.
  // Failure mode: operators would sign a plan without seeing which settings handles changed or which new SubHandle is being allocated.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "pz_contract_06",
      settings: {
        bg_policy_ids: "live-aa",
        pfp_policy_ids: "bb",
        pz_settings: "live-cc",
      },
    },
    nextSubhandle: "personalization7@handlecontract",
  });

  assert.equal(plan.driftType, "script_hash_and_settings");
  assert.deepEqual(
    plan.summaryJson.contracts[0].settings.diff_rows.map((row) => row.handle_name),
    ["bg_policy_ids", "pz_settings"]
  );
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, "personalization7@handlecontract");
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

test("discovers the next available personalization SubHandle ordinal", async () => {
  // Feature: script-hash deployments allocate the next free <contract_slug><ordinal>@handlecontract name.
  // Failure mode: a generated plan could collide with an already published deployment handle.
  const requested = [];
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    contractSlug: "personalization",
    namespace: "handlecontract",
    userAgent: "codex-test",
    fetchFn: async (url) => {
      requested.push(String(url));
      return new Response("{}", {
        status: String(url).endsWith("personalization3%40handlecontract") ? 404 : 200,
      });
    },
  });

  assert.equal(subhandle, "personalization3@handlecontract");
  assert.deepEqual(requested, [
    "https://preview.api.handle.me/handles/personalization1%40handlecontract",
    "https://preview.api.handle.me/handles/personalization2%40handlecontract",
    "https://preview.api.handle.me/handles/personalization3%40handlecontract",
  ]);
});

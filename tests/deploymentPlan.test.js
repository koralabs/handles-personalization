import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import cbor from "cbor";

import {
  buildPersonalizationDeploymentTxArtifact,
  buildPersonalizationSettingsUpdateArtifact,
  buildExpectedScriptHashes,
  buildPersonalizationDeploymentPlan,
  decodePzSettingsDatum,
  discoverNextContractSubhandle,
  fetchLiveDeploymentState,
  renderTransactionOrderMarkdown,
} from "../deploymentPlan.js";

const PROXY_HASH = "ab".repeat(28);
const LOGIC_HASH = "cd".repeat(28);

const desiredState = {
  schemaVersion: 3,
  network: "preview",
  subhandleStrategy: {
    namespace: "handlecontract",
    format: "contract_slug_ordinal",
  },
  contracts: [
    {
      contractSlug: "perspz",
      scriptType: "perspz",
      oldScriptType: null,
      deploymentHandleSlug: "perspz",
      build: {
        target: "aiken/validators/perspz.ak",
        kind: "validator",
        parameters: {},
      },
    },
    {
      contractSlug: "persprx",
      scriptType: "persprx",
      oldScriptType: "pz",
      deploymentHandleSlug: "persprx",
      build: {
        target: "aiken/validators/persprx.ak",
        kind: "validator",
        parameters: {},
      },
    },
  ],
  assignedHandles: {
    settings: ["pers@handle_settings", "pers_bg@handle_settings", "pers_pfp@handle_settings"],
    scripts: ["pz_contract_06"],
  },
  ignoredSettings: [],
  settings: {
    type: "personalization_settings",
    values: {
      "pers@handle_settings": {
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

test("expected script hashes are read from per-validator compileAiken artifacts", () => {
  // Feature: deployment planning derives expected hashes from repo-native compile artifacts, one per validator slug.
  // Failure mode: artifact plans could diff against stale hardcoded hashes instead of the freshly built contracts.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-hash-"));
  let compiled = 0;
  const hashes = buildExpectedScriptHashes({
    compileFn: () => {
      compiled += 1;
      fs.writeFileSync(path.join(tempDir, "aiken.persprx.hash"), PROXY_HASH);
      fs.writeFileSync(path.join(tempDir, "aiken.perspz.hash"), LOGIC_HASH);
    },
    artifactPaths: {
      perValidator: (slug) => ({ hash: path.join(tempDir, `aiken.${slug}.hash`) }),
    },
    slugs: ["persprx", "perspz"],
  });

  assert.deepEqual(hashes, { persprx: PROXY_HASH, perspz: LOGIC_HASH });
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

test("fetches live state for every contract declared in the desired YAML", async () => {
  // Feature: the planner reads live script state per-contract using each contract's old_script_type.
  // Failure mode: only one contract's drift would be observed; subsequent contracts would always look "no_change".
  const requests = [];
  const live = await fetchLiveDeploymentState({
    network: "preview",
    desired: desiredState,
    userAgent: "codex-test",
    fetchFn: async (url) => {
      requests.push(String(url));
      const text = String(url);
      if (text.includes("/scripts?latest=true&type=pz")) {
        return new Response(
          JSON.stringify({ validatorHash: "ab".repeat(28), handle: "pz_contract_06" }),
          { status: 200 }
        );
      }
      if (text.includes("/datum")) {
        return new Response(previewDatum, { status: 200 });
      }
      return new Response(JSON.stringify({ utxo: "tx#0" }), { status: 200 });
    },
  });

  // persprx has old_script_type=pz → live state populated.
  assert.equal(live.contracts.persprx.currentScriptHash, "ab".repeat(28));
  assert.equal(live.contracts.persprx.currentSubhandle, "pz_contract_06");
  // perspz has old_script_type=null → no live state.
  assert.equal(live.contracts.perspz.currentScriptHash, null);
  assert.equal(live.contracts.perspz.currentSubhandle, null);

  assert.deepEqual(live.currentSettingsUtxoRefs, {
    "pers_bg@handle_settings": "tx#0",
    "pers_pfp@handle_settings": "tx#0",
    "pers@handle_settings": "tx#0",
  });
  assert.equal(live.settings["pers@handle_settings"].treasury_fee, 1500000);
  assert.ok(requests.some((url) => url.endsWith("/scripts?latest=true&type=pz")));
});

test("builds a no-change deployment plan when both contracts and settings match", () => {
  // Feature: push/PR planning should not request a deployment when personalization live state already matches committed YAML.
  // Failure mode: ops would get false-positive deployment plans for a clean network.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHashes: { persprx: PROXY_HASH, perspz: LOGIC_HASH },
    live: {
      contracts: {
        persprx: { currentScriptHash: PROXY_HASH, currentSubhandle: "persprx01@handlecontract" },
        perspz: { currentScriptHash: LOGIC_HASH, currentSubhandle: "perspz01@handlecontract" },
      },
      settings: desiredState.settings.values,
    },
    nextSubhandles: {},
  });

  assert.equal(plan.driftType, "no_change");
  assert.equal(plan.summaryJson.contracts.length, 2);
  assert.ok(plan.summaryJson.contracts.every((c) => c.drift_type === "no_change"));
  assert.deepEqual(plan.summaryJson.transaction_order, []);
  assert.match(plan.summaryMarkdown, /No settings changes/);
});

test("builds a script-and-settings deployment plan when both drift", () => {
  // Feature: deployment planning must report both contract drift (per-contract) and settings drift when personalization changes on both surfaces.
  // Failure mode: operators would sign a plan without seeing the decoded settings change or the newly allocated handle.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHashes: { persprx: PROXY_HASH, perspz: LOGIC_HASH },
    live: {
      contracts: {
        persprx: { currentScriptHash: "ee".repeat(28), currentSubhandle: "pz_contract_06" },
        perspz: { currentScriptHash: null, currentSubhandle: null },
      },
      settings: {
        "pers@handle_settings": {
          ...desiredState.settings.values["pers@handle_settings"],
          subhandle_share_percent: 40,
        },
      },
    },
    nextSubhandles: {
      persprx: "persprx7@handlecontract",
      perspz: "perspz1@handlecontract",
    },
  });

  assert.equal(plan.driftType, "script_hash_and_settings");
  assert.equal(plan.summaryJson.settings.changed, true);
  assert.equal(plan.summaryJson.settings.diff_rows[0].handle_name, "pers@handle_settings");
  const proxy = plan.summaryJson.contracts.find((c) => c.contract_slug === "persprx");
  const logic = plan.summaryJson.contracts.find((c) => c.contract_slug === "perspz");
  assert.equal(proxy.drift_type, "script_hash_only");
  assert.equal(proxy.subhandle.value, "persprx7@handlecontract");
  assert.equal(logic.drift_type, "script_hash_only");
  assert.equal(logic.subhandle.value, "perspz1@handlecontract");
});

test("marks per-contract script drift for manual review when no replacement handle is resolved", () => {
  // Feature: the first-pass workflow can still emit honest artifacts when the repo's live deployment handle namespace is not auto-allocatable yet.
  // Failure mode: planning would fail outright on script drift instead of producing a review-required artifact bundle.
  const plan = buildPersonalizationDeploymentPlan({
    desired: desiredState,
    expectedScriptHashes: { persprx: PROXY_HASH, perspz: LOGIC_HASH },
    live: {
      contracts: {
        persprx: { currentScriptHash: "ee".repeat(28), currentSubhandle: "pz_contract_06" },
        perspz: { currentScriptHash: LOGIC_HASH, currentSubhandle: "perspz1@handlecontract" },
      },
      settings: desiredState.settings.values,
    },
    nextSubhandles: {},
  });

  const proxy = plan.summaryJson.contracts.find((c) => c.contract_slug === "persprx");
  assert.equal(proxy.subhandle.action, "manual_review");
  assert.equal(proxy.subhandle.value, "pz_contract_06");
  assert.match(plan.summaryMarkdown, /operator review/i);
});

test("discoverNextContractSubhandle delegates to the canonical Python helper", async () => {
  // The discovery logic itself is owned by adahandle-deployments/common/discover_subhandles.py
  // and tested at common/discover_subhandles_test.py. Here we only verify
  // that the JS wrapper invokes the right script and returns its stdout —
  // we point DISCOVER_SUBHANDLES_PATH at a stub that prints what we expect
  // and check the wrapper passes the SubHandle through verbatim.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-stub-"));
  const stubPath = path.join(tmpDir, "discover_subhandles.py");
  fs.writeFileSync(
    stubPath,
    "#!/usr/bin/env python3\n" +
      "import sys\n" +
      "for i, a in enumerate(sys.argv):\n" +
      "  if a == '--slug': slug = sys.argv[i+1]\n" +
      "print(f'{slug}1@handlecontract')\n",
    { mode: 0o755 }
  );
  const origPath = process.env.DISCOVER_SUBHANDLES_PATH;
  process.env.DISCOVER_SUBHANDLES_PATH = stubPath;
  try {
    const subhandle = await discoverNextContractSubhandle({
      network: "preview",
      deploymentHandleSlug: "persprx",
      namespace: "handlecontract",
      currentSubhandle: null,
      userAgent: "codex-test",
    });
    assert.equal(subhandle, "persprx1@handlecontract");
  } finally {
    process.env.DISCOVER_SUBHANDLES_PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("passes through the cardano-sdk deployment tx artifact shape", async () => {
  // Feature: deployment artifacts must write raw CBOR bytes to `tx-NN.cbor` and keep hex in a sidecar file, parameterized by contract slug.
  // Failure mode: wallets would reject the artifact because the `.cbor` file contained printable hex text instead of CBOR bytes.
  const fakeBuilderResult = {
    cborHex: "840102",
    cborBytes: Buffer.from([0x84, 0x01, 0x02]),
    estimatedSignedTxSize: 4,
    maxTxSize: 10,
    contractSlug: "persprx",
    txId: "0".repeat(64),
    handleUtxoRef: "ab".repeat(32) + "#0",
    consumedInputs: new Set([`${"ab".repeat(32)}#0`]),
  };

  const artifact = await buildPersonalizationDeploymentTxArtifact({
    desired: desiredState,
    contract: desiredState.contracts.find((c) => c.contractSlug === "persprx"),
    handleName: "persprx7@handlecontract",
    changeAddress: "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej",
    cborUtxos: ["abcd"],
    blockfrostApiKey: "preview-test",
    buildTxFn: async () => fakeBuilderResult,
  });

  assert.deepEqual([...artifact.cborBytes], [0x84, 0x01, 0x02]);
  assert.equal(artifact.cborHex, "840102");
  assert.equal(artifact.estimatedSignedTxSize, 4);
  assert.equal(artifact.maxTxSize, 10);
  assert.equal(artifact.contractSlug, "persprx");
});

test("rejects unsigned deployment tx artifacts that would exceed max tx size after signing", async () => {
  // Feature: the planner must fail before uploading a tx artifact that becomes oversized once the signer adds its witness.
  // Failure mode: ops would receive a CBOR file that imports locally but is rejected on submit because the signed tx exceeds protocol size limits.
  const fakeBuilderResult = {
    cborHex: "00".repeat(150),
    cborBytes: Buffer.alloc(150),
    estimatedSignedTxSize: 350,
    maxTxSize: 300,
    contractSlug: "persprx",
  };

  await assert.rejects(
    buildPersonalizationDeploymentTxArtifact({
      desired: desiredState,
      contract: desiredState.contracts.find((c) => c.contractSlug === "persprx"),
      handleName: "persprx7@handlecontract",
      changeAddress: "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej",
      cborUtxos: ["abcd"],
      blockfrostApiKey: "preview-test",
      buildTxFn: async () => fakeBuilderResult,
    }),
    /too large after adding 1 required signature/i
  );
});

test("renders transaction order markdown from generated artifacts", () => {
  // Feature: the human summary must show generated tx artifact names when the planner emits them.
  // Failure mode: operators would read a stale summary claiming no tx artifacts exist even though the workflow uploaded them.
  assert.deepEqual(renderTransactionOrderMarkdown(["tx-01.cbor", "tx-02.cbor"]), [
    "- `tx-01.cbor`",
    "- `tx-02.cbor`",
  ]);
  assert.deepEqual(renderTransactionOrderMarkdown([]), [
    "- Planner can emit `tx-NN.cbor` artifacts when the deployer wallet inputs are supplied.",
  ]);
});

test("settings update artifact emits a patched datum and a change log when valid_contracts grows", () => {
  // Feature: settings-only drift produces a canonical patched-datum.cbor + change log so the multisig signer can review and sign.
  // Failure mode: ops would have to compute the patched datum manually for every settings change.
  const desired = {
    ...desiredState,
    settings: {
      ...desiredState.settings,
      values: {
        "pers@handle_settings": {
          ...desiredState.settings.values["pers@handle_settings"],
          valid_contracts: [
            ...desiredState.settings.values["pers@handle_settings"].valid_contracts,
            "91c9830776b2169e0a4a3227a4fda22d10bf253e91b31eb4115964ff",
          ],
        },
      },
    },
  };
  const live = {
    pzSettingsDatumHex: previewDatum,
    currentSettingsUtxoRefs: { "pers@handle_settings": "abcd#0" },
  };
  const artifact = buildPersonalizationSettingsUpdateArtifact({ live, desired });

  assert.equal(artifact.handleName, "pers@handle_settings");
  assert.equal(artifact.handleUtxoRef, "abcd#0");
  assert.equal(artifact.oldDatumHex, previewDatum);
  assert.notEqual(artifact.newDatumHex, previewDatum);
  assert.equal(artifact.changeLog.length, 1);
  assert.match(artifact.changeLog[0], /^valid_contracts: 1 -> 2/);

  const fields = cbor.decodeFirstSync(artifact.newDatumCborBytes);
  assert.equal(fields[4].length, 2);
  assert.equal(
    Buffer.from(fields[4][1]).toString("hex"),
    "91c9830776b2169e0a4a3227a4fda22d10bf253e91b31eb4115964ff"
  );
});

test("settings update artifact reports an empty change log when desired matches live", () => {
  // Feature: re-running the planner against a network already at the desired state must produce a no-op artifact, not a phantom diff.
  // Failure mode: ops would re-sign and re-submit identical settings updates indefinitely.
  const live = {
    pzSettingsDatumHex: previewDatum,
    currentSettingsUtxoRefs: { "pers@handle_settings": "abcd#0" },
  };
  const artifact = buildPersonalizationSettingsUpdateArtifact({ live, desired: desiredState });

  assert.deepEqual(artifact.changeLog, []);
  assert.equal(artifact.newDatumHex, previewDatum);
});

test("settings update artifact rejects missing live raw datum hex", () => {
  // Feature: artifact builder must hard-fail if the live state fetcher didn't include the raw datum hex (otherwise it would silently skip CBOR-byte preservation).
  // Failure mode: operators would get re-encoded datums even when no fields changed, causing spurious diffs.
  assert.throws(
    () => buildPersonalizationSettingsUpdateArtifact({ live: {}, desired: desiredState }),
    /pzSettingsDatumHex/
  );
});

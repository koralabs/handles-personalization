import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { Buffer } from "node:buffer";

import * as helios from "@koralabs/helios";

import {
  getAikenArtifactPaths,
  PERSONALIZATION_VALIDATOR_SLUGS,
} from "./compileHelpers.js";
import {
  buildReferenceScriptDeploymentTx,
  fetchNetworkParameters,
} from "./deploymentTx.js";
import { PERSONALIZATION_SETTINGS_HANDLES } from "./deploymentState.js";
import { buildPatchedSettingsDatum } from "./buildPatchedSettingsDatum.js";
import { buildSettingsUpdateTx } from "./settingsUpdateTx.js";

const REPO_NAME = "handles-personalization";
const COMPARABLE_SETTINGS_HANDLE = "pz_settings";

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

export const compilePersonalizationArtifacts = () => {
  execFileSync("node", ["./compileAiken.js"], { stdio: "inherit" });
};

// Returns a map of validator slug → expected script hash hex.
export const buildExpectedScriptHashes = ({
  compileFn = compilePersonalizationArtifacts,
  artifactPaths = getAikenArtifactPaths(),
  slugs = PERSONALIZATION_VALIDATOR_SLUGS,
} = {}) => {
  compileFn();
  const result = {};
  for (const slug of slugs) {
    const path = artifactPaths.perValidator(slug).hash;
    result[slug] = fs.readFileSync(path, "utf8").trim();
  }
  return result;
};

export const renderTransactionOrderMarkdown = (transactionOrder) =>
  transactionOrder.length > 0
    ? transactionOrder.map((fileName) => `- \`${fileName}\``)
    : ["- Planner can emit `tx-NN.cbor` artifacts when the deployer wallet inputs are supplied."];

export const decodePzSettingsDatum = (datumHex) => {
  const fields = requireListData(
    helios.UplcData.fromCbor(stripHexPrefix(datumHex)),
    "pz_settings datum"
  );
  if (fields.length !== 9) {
    throw new Error(`pz_settings datum must contain 9 fields, received ${fields.length}`);
  }
  return {
    treasury_fee: requireInt(fields[0], "treasury_fee"),
    treasury_cred: requireByteArray(fields[1], "treasury_cred"),
    pz_min_fee: requireInt(fields[2], "pz_min_fee"),
    pz_providers: Object.fromEntries(
      requireMapData(fields[3], "pz_providers")
        .map(([key, value]) => [
          requireByteArray(key, "pz_providers key"),
          requireByteArray(value, "pz_providers value"),
        ])
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    valid_contracts: requireListData(fields[4], "valid_contracts").map((field) =>
      requireByteArray(field, "valid_contracts item")
    ),
    admin_creds: requireListData(fields[5], "admin_creds").map((field) =>
      requireByteArray(field, "admin_creds item")
    ),
    settings_cred: requireByteArray(fields[6], "settings_cred"),
    grace_period: requireInt(fields[7], "grace_period"),
    subhandle_share_percent: requireInt(fields[8], "subhandle_share_percent"),
  };
};

// Fetches the latest live state for every contract declared in the desired
// YAML, plus the pz_settings datum. Per-contract scripts are looked up by
// `old_script_type` (or, if null, treated as "never deployed under that slug").
export const fetchLiveDeploymentState = async ({
  network,
  desired,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  const headers = { "User-Agent": userAgent };

  const contracts = {};
  for (const contract of desired.contracts) {
    if (!contract.oldScriptType) {
      contracts[contract.contractSlug] = {
        currentScriptHash: null,
        currentSubhandle: null,
      };
      continue;
    }
    const scriptUrl = `${baseUrl}/scripts?latest=true&type=${encodeURIComponent(contract.oldScriptType)}`;
    const scriptResponse = await fetchFn(scriptUrl, { headers });
    if (scriptResponse.status === 404) {
      contracts[contract.contractSlug] = {
        currentScriptHash: null,
        currentSubhandle: null,
      };
      continue;
    }
    if (!scriptResponse.ok) {
      throw new Error(
        `failed to load live script for ${contract.contractSlug} (type=${contract.oldScriptType}): HTTP ${scriptResponse.status}`
      );
    }
    const scriptPayload = await scriptResponse.json();
    contracts[contract.contractSlug] = {
      currentScriptHash:
        String(scriptPayload.validatorHash ?? scriptPayload.scriptHash ?? "").trim() || null,
      currentSubhandle: String(scriptPayload.handle ?? "").trim() || null,
    };
  }

  const currentSettingsUtxoRefs = {};
  for (const handleName of PERSONALIZATION_SETTINGS_HANDLES) {
    const handleResponse = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(handleName)}`,
      { headers }
    );
    if (!handleResponse.ok) {
      throw new Error(`failed to load handle ${handleName}: HTTP ${handleResponse.status}`);
    }
    const handlePayload = await handleResponse.json();
    const utxoRef = String(handlePayload.utxo ?? "").trim();
    if (utxoRef) {
      currentSettingsUtxoRefs[handleName] = utxoRef;
    }
  }

  const datumResponse = await fetchFn(
    `${baseUrl}/handles/${encodeURIComponent(COMPARABLE_SETTINGS_HANDLE)}/datum`,
    { headers }
  );
  if (!datumResponse.ok) {
    throw new Error(
      `failed to load datum for ${COMPARABLE_SETTINGS_HANDLE}: HTTP ${datumResponse.status}`
    );
  }
  const pzSettingsDatumHex = (await datumResponse.text()).trim();

  return {
    contracts,
    settings: { pz_settings: decodePzSettingsDatum(pzSettingsDatumHex) },
    pzSettingsDatumHex,
    currentSettingsUtxoRefs,
  };
};

const parseHandleOrdinal = ({ candidate, deploymentHandleSlug, namespace }) => {
  const prefix = deploymentHandleSlug;
  const suffix = `@${namespace}`;
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) {
    return null;
  }
  const ordinalText = candidate.slice(prefix.length, candidate.length - suffix.length);
  if (!/^[0-9]+$/.test(ordinalText)) {
    return null;
  }
  return Number.parseInt(ordinalText, 10);
};

export const discoverNextContractSubhandle = async ({
  network,
  deploymentHandleSlug,
  namespace,
  currentSubhandle = null,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  const existingOrdinals = [];
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${deploymentHandleSlug}${ordinal}@${namespace}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) {
      const currentOrdinal = currentSubhandle
        ? parseHandleOrdinal({ candidate: currentSubhandle, deploymentHandleSlug, namespace }) || 0
        : 0;
      const existingReplacement = existingOrdinals.find((existingOrdinal) => existingOrdinal > currentOrdinal);
      return existingReplacement
        ? `${deploymentHandleSlug}${existingReplacement}@${namespace}`
        : candidate;
    }
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
    existingOrdinals.push(ordinal);
  }
  throw new Error(`no available SubHandle found for ${deploymentHandleSlug}@${namespace}`);
};

// `nextSubhandles` is an optional map of contractSlug → SubHandle string.
// When omitted for a slug that needs allocation, the contract's subhandle
// action is reported as `manual_review`.
export const buildPersonalizationDeploymentPlan = ({
  desired,
  expectedScriptHashes,
  live,
  nextSubhandles = {},
}) => {
  const settingsChanged =
    stableStringify(live.settings.pz_settings) !==
    stableStringify(desired.settings.values.pz_settings);
  const settingsDiffRows = settingsChanged
    ? [{
        handle_name: COMPARABLE_SETTINGS_HANDLE,
        current: live.settings.pz_settings,
        desired: desired.settings.values.pz_settings,
      }]
    : [];

  const contractEntries = desired.contracts.map((contract) => {
    const expectedHash = expectedScriptHashes[contract.contractSlug];
    if (!expectedHash) {
      throw new Error(`expected script hash missing for contract ${contract.contractSlug}`);
    }
    const liveContract = live.contracts[contract.contractSlug] || {};
    const currentHash = liveContract.currentScriptHash || null;
    const currentSubhandle = liveContract.currentSubhandle || null;
    const scriptChanged = currentHash !== expectedHash;
    const requestedSubhandle = nextSubhandles[contract.contractSlug] || null;

    const plannedSubhandle = scriptChanged
      ? requestedSubhandle ||
        currentSubhandle ||
        `${contract.deploymentHandleSlug}@${desired.subhandleStrategy.namespace}`
      : currentSubhandle;
    const subhandleAction = scriptChanged
      ? requestedSubhandle
        ? "allocate"
        : "manual_review"
      : "reuse";

    return {
      contract_slug: contract.contractSlug,
      drift_type: scriptChanged ? "script_hash_only" : "no_change",
      script_hashes: { current: currentHash, expected: expectedHash },
      subhandle: {
        action: subhandleAction,
        value: plannedSubhandle,
        is_new: scriptChanged && Boolean(requestedSubhandle),
      },
      build: {
        target: contract.build.target,
        kind: contract.build.kind,
      },
    };
  });

  const anyScriptChanged = contractEntries.some((c) => c.drift_type !== "no_change");
  const overallDriftType = anyScriptChanged && settingsChanged
    ? "script_hash_and_settings"
    : anyScriptChanged
      ? "script_hash_only"
      : settingsChanged
        ? "settings_only"
        : "no_change";

  const planId = crypto
    .createHash("sha256")
    .update(
      stableStringify({
        network: desired.network,
        contracts: contractEntries.map((c) => ({
          slug: c.contract_slug,
          current: c.script_hashes.current,
          expected: c.script_hashes.expected,
          subhandle: c.subhandle.value,
        })),
        current_settings: live.settings,
        desired_settings: desired.settings.values,
        assigned_handles: desired.assignedHandles,
        ignored_settings: desired.ignoredSettings,
      })
    )
    .digest("hex");

  const summaryJson = {
    plan_id: planId,
    repo: REPO_NAME,
    network: desired.network,
    drift_type: overallDriftType,
    settings: {
      type: desired.settings.type,
      changed: settingsChanged,
      diff_rows: settingsDiffRows,
      desired_values: desired.settings.values,
      ignored_paths: desired.ignoredSettings,
    },
    contracts: contractEntries,
    transaction_order: [],
  };

  const summaryMarkdown = [
    "# Contract Deployment Plan",
    "",
    `- Plan ID: \`${planId}\``,
    `- Repo: \`${REPO_NAME}\``,
    `- Network: \`${desired.network}\``,
    `- Overall drift: \`${overallDriftType}\``,
    "",
    "## Per-contract drift",
    ...contractEntries.flatMap((c) => [
      `### \`${c.contract_slug}\``,
      `- Drift: \`${c.drift_type}\``,
      `- Script hash: \`${c.script_hashes.current ?? "(none)"}\` -> \`${c.script_hashes.expected}\``,
      `- SubHandle: \`${c.subhandle.value ?? "(unassigned)"}\` (\`${c.subhandle.action}\`)`,
      "",
    ]),
    "## Settings drift",
    ...(settingsDiffRows.length > 0
      ? settingsDiffRows.map((row) => `- \`${row.handle_name}\``)
      : ["- No settings changes."]),
    "",
    "## Transaction Order",
    ...renderTransactionOrderMarkdown([]),
    ...(contractEntries.some((c) => c.subhandle.action === "manual_review")
      ? ["- Script drift requires operator review of the replacement deployment handle namespace."]
      : []),
  ].join("\n");

  return {
    planId,
    driftType: overallDriftType,
    summaryJson,
    summaryMarkdown,
    deploymentPlanJson: {
      plan_id: planId,
      repo: REPO_NAME,
      network: desired.network,
      drift_type: overallDriftType,
      contracts: contractEntries,
      settings_drift: summaryJson.settings,
      transaction_order: [],
    },
  };
};

// Settings-only artifact: re-encodes the comparable settings datum with
// patches from the desired YAML, leaving every unchanged field's bytes
// alone. Returns the new datum hex and a human-readable change log so the
// multisig signer can review what's being changed before producing a
// signed tx.
export const buildPersonalizationSettingsUpdateArtifact = ({
  live,
  desired,
  buildPatchedDatumFn = buildPatchedSettingsDatum,
}) => {
  if (!live?.pzSettingsDatumHex) {
    throw new Error(
      "settings-only artifact requires live.pzSettingsDatumHex; ensure fetchLiveDeploymentState ran"
    );
  }
  const desiredPzSettings =
    desired?.settings?.values?.pz_settings ?? desired?.settings?.values?.[COMPARABLE_SETTINGS_HANDLE];
  if (!desiredPzSettings) {
    throw new Error(`desired settings.values.${COMPARABLE_SETTINGS_HANDLE} missing from YAML`);
  }
  const { newDatumHex, changeLog } = buildPatchedDatumFn(
    live.pzSettingsDatumHex,
    desiredPzSettings
  );
  return {
    handleName: COMPARABLE_SETTINGS_HANDLE,
    handleUtxoRef: live.currentSettingsUtxoRefs?.[COMPARABLE_SETTINGS_HANDLE] ?? null,
    oldDatumHex: live.pzSettingsDatumHex,
    newDatumHex,
    newDatumCborBytes: Buffer.from(newDatumHex, "hex"),
    changeLog,
  };
};

export const buildPersonalizationSettingsUpdateTxArtifact = async ({
  live,
  desired,
  nativeScriptCborHex,
  blockfrostApiKey,
  userAgent,
  buildSettingsArtifactFn = buildPersonalizationSettingsUpdateArtifact,
  buildSettingsUpdateTxFn = buildSettingsUpdateTx,
}) => {
  const settingsArtifact = buildSettingsArtifactFn({ live, desired });
  if (settingsArtifact.changeLog.length === 0) {
    return { settingsArtifact, txArtifact: null };
  }
  const txArtifact = await buildSettingsUpdateTxFn({
    network: desired.network,
    settingsHandleName: settingsArtifact.handleName,
    patchedDatumHex: settingsArtifact.newDatumHex,
    nativeScriptCborHex,
    blockfrostApiKey,
    userAgent,
  });
  return { settingsArtifact, txArtifact };
};

export const buildPersonalizationDeploymentTxArtifact = async ({
  desired,
  contract,
  handleName,
  changeAddress,
  cborUtxos,
  buildTxFn = buildReferenceScriptDeploymentTx,
  fetchNetworkParametersFn = fetchNetworkParameters,
}) => {
  if (!contract) {
    throw new Error("buildPersonalizationDeploymentTxArtifact: contract is required");
  }
  const tx = await buildTxFn({
    network: desired.network,
    contractSlug: contract.contractSlug,
    handleName,
    changeAddress,
    cborUtxos,
  });
  tx.witnesses.addDummySignatures(1);
  const estimatedSignedTxSize = tx.toCbor().length;
  tx.witnesses.removeDummySignatures(1);

  const networkParams = await fetchNetworkParametersFn(desired.network);
  const maxTxSize = networkParams.maxTxSize;
  if (estimatedSignedTxSize > maxTxSize) {
    throw new Error(
      `unsigned deployment tx for ${handleName} (${contract.contractSlug}) is too large after adding 1 required signature: ${estimatedSignedTxSize} > ${maxTxSize}`
    );
  }

  const cborBytes = Buffer.from(tx.toCbor());
  return {
    cborBytes,
    cborHex: cborBytes.toString("hex"),
    estimatedSignedTxSize,
    maxTxSize,
    contractSlug: contract.contractSlug,
  };
};

const requireListData = (value, label) => {
  if (!value || !Array.isArray(value.list)) {
    throw new Error(`${label} must decode to a list`);
  }
  return value.list;
};

const requireMapData = (value, label) => {
  if (!value || !Array.isArray(value.map)) {
    throw new Error(`${label} must decode to a map`);
  }
  return value.map;
};

const requireByteArray = (value, label) => {
  if (!value || typeof value.hex !== "string") {
    throw new Error(`${label} must decode to a byte array`);
  }
  return value.hex;
};

const requireInt = (value, label) => {
  if (!value || (typeof value.value !== "bigint" && typeof value.value !== "number")) {
    throw new Error(`${label} must decode to an int`);
  }
  return Number(value.value);
};

const stripHexPrefix = (value) => value.startsWith("0x") ? value.slice(2) : value;

const normalizeStable = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeStable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeStable(nested)])
    );
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(normalizeStable(value));

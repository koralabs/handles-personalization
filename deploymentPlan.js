import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import * as helios from "@koralabs/helios";

import { getAikenArtifactPaths } from "./compileHelpers.js";
import { PERSONALIZATION_SETTINGS_HANDLES } from "./deploymentState.js";

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

export const buildExpectedPersonalizationScriptHash = ({
  compileFn = compilePersonalizationArtifacts,
  spendHashPath = getAikenArtifactPaths().spendHash,
} = {}) => {
  compileFn();
  return fs.readFileSync(spendHashPath, "utf8").trim();
};

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

export const fetchLivePersonalizationDeploymentState = async ({
  network,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  const headers = { "User-Agent": userAgent };
  const scriptResponse = await fetchFn(`${baseUrl}/scripts?latest=true`, { headers });
  if (!scriptResponse.ok) {
    throw new Error(`failed to load live personalization script: HTTP ${scriptResponse.status}`);
  }
  const scriptPayload = await scriptResponse.json();
  const currentScriptHash = String(
    scriptPayload.validatorHash ?? scriptPayload.scriptHash ?? ""
  ).trim();
  if (!currentScriptHash) {
    throw new Error("live personalization script response missing validatorHash/scriptHash");
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

  return {
    currentScriptHash,
    currentSubhandle: String(scriptPayload.handle ?? "").trim() || null,
    currentSettingsUtxoRefs,
    settings: {
      pz_settings: decodePzSettingsDatum((await datumResponse.text()).trim()),
    },
  };
};

export const discoverNextContractSubhandle = async ({
  network,
  deploymentHandleSlug,
  namespace,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${deploymentHandleSlug}${ordinal}@${namespace}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) {
      return candidate;
    }
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
  }
  throw new Error(`no available SubHandle found for ${deploymentHandleSlug}@${namespace}`);
};

export const buildPersonalizationDeploymentPlan = ({
  desired,
  expectedScriptHash,
  live,
  nextSubhandle,
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

  const scriptChanged = live.currentScriptHash !== expectedScriptHash;
  const driftType = scriptChanged && settingsChanged
    ? "script_hash_and_settings"
    : scriptChanged
      ? "script_hash_only"
      : settingsChanged
        ? "settings_only"
        : "no_change";

  const plannedSubhandle = scriptChanged
    ? nextSubhandle || live.currentSubhandle || `${desired.deploymentHandleSlug}@${desired.subhandleStrategy.namespace}`
    : live.currentSubhandle;
  if (!plannedSubhandle) {
    throw new Error("deployment plan requires a resolved SubHandle");
  }
  const subhandleAction = scriptChanged
    ? nextSubhandle
      ? "allocate"
      : "manual_review"
    : "reuse";

  const expectedPostDeployState = {
    repo: REPO_NAME,
    network: desired.network,
    contract_slug: desired.contractSlug,
    expected_script_hash: expectedScriptHash,
    expected_subhandle: plannedSubhandle,
    assigned_handles: {
      settings: desired.assignedHandles.settings,
      scripts: scriptChanged ? [plannedSubhandle] : desired.assignedHandles.scripts,
    },
    settings: {
      type: desired.settings.type,
      values: desired.settings.values,
      ignored_paths: desired.ignoredSettings,
    },
  };

  const planId = crypto
    .createHash("sha256")
    .update(
      stableStringify({
        network: desired.network,
        contract_slug: desired.contractSlug,
        current_script_hash: live.currentScriptHash,
        expected_script_hash: expectedScriptHash,
        current_settings: live.settings,
        desired_settings: desired.settings.values,
        assigned_handles: desired.assignedHandles,
        ignored_settings: desired.ignoredSettings,
        planned_subhandle: plannedSubhandle,
      })
    )
    .digest("hex");

  const summaryJson = {
    plan_id: planId,
    repo: REPO_NAME,
    network: desired.network,
    contracts: [
      {
        contract_slug: desired.contractSlug,
        drift_type: driftType,
        script_hashes: {
          current: live.currentScriptHash,
          expected: expectedScriptHash,
        },
        settings: {
          type: desired.settings.type,
          diff_rows: settingsDiffRows,
          desired_values: desired.settings.values,
          ignored_paths: desired.ignoredSettings,
        },
        subhandle: {
          action: subhandleAction,
          value: plannedSubhandle,
          is_new: scriptChanged && Boolean(nextSubhandle),
        },
        expected_post_deploy_state: expectedPostDeployState,
      },
    ],
    transaction_order: [],
  };

  const summaryMarkdown = [
    "# Contract Deployment Plan",
    "",
    `- Plan ID: \`${planId}\``,
    `- Repo: \`${REPO_NAME}\``,
    `- Network: \`${desired.network}\``,
    `- Contract: \`${desired.contractSlug}\``,
    `- Drift Type: \`${driftType}\``,
    `- Script Hash: \`${live.currentScriptHash}\` -> \`${expectedScriptHash}\``,
    `- SubHandle: \`${plannedSubhandle}\``,
    "",
    "## Settings Drift",
    ...(settingsDiffRows.length > 0
      ? settingsDiffRows.map((row) => `- \`${row.handle_name}\``)
      : ["- No settings changes."]),
    "",
    "## Transaction Order",
    "- No transaction artifact is generated for this repo yet.",
    ...(subhandleAction === "manual_review"
      ? ["- Script drift requires operator review of the replacement deployment handle namespace."]
      : []),
  ].join("\n");

  return {
    planId,
    driftType,
    summaryJson,
    summaryMarkdown,
    deploymentPlanJson: {
      plan_id: planId,
      repo: REPO_NAME,
      network: desired.network,
      contracts: [expectedPostDeployState],
      transaction_order: [],
    },
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

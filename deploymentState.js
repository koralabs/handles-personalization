import fs from "node:fs/promises";

import YAML from "yaml";

const ALLOWED_NETWORKS = new Set(["preview", "preprod", "mainnet"]);
const ALLOWED_BUILD_KINDS = new Set(["validator", "minting_policy"]);
const ALLOWED_SUBHANDLE_FORMATS = new Set(["contract_slug_ordinal"]);
const OBSERVED_ONLY_FIELDS = new Set([
  "current_script_hash",
  "current_settings_utxo_ref",
  "current_subhandle",
  "observed_at",
  "last_deployed_tx_hash",
]);
const PERSONALIZATION_SETTINGS_KEYS = [
  "bg_policy_ids",
  "pfp_policy_ids",
  "pz_settings",
];

export const loadDesiredDeploymentState = async (path) => {
  const raw = await fs.readFile(path, "utf8");
  return parseDesiredDeploymentState(raw, path);
};

export const parseDesiredDeploymentState = (
  raw,
  sourceLabel = "desired deployment state"
) => {
  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must be a YAML object`);
  }

  const value = parsed;
  const observedOnlyField = Object.keys(value).find((key) =>
    OBSERVED_ONLY_FIELDS.has(key)
  );
  if (observedOnlyField) {
    throw new Error(
      `${sourceLabel} must not include observed-only field \`${observedOnlyField}\``
    );
  }

  const schemaVersion = requireNumber(value, "schema_version", sourceLabel);
  if (schemaVersion !== 1) {
    throw new Error(`${sourceLabel} schema_version must equal 1`);
  }

  const network = requireString(value, "network", sourceLabel);
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

  const contractSlug = requireString(value, "contract_slug", sourceLabel);
  const build = requireObject(value, "build", sourceLabel);
  const buildTarget = requireString(build, "target", `${sourceLabel}.build`);
  const buildKind = requireString(build, "kind", `${sourceLabel}.build`);
  if (!ALLOWED_BUILD_KINDS.has(buildKind)) {
    throw new Error(`${sourceLabel}.build kind must be validator or minting_policy`);
  }
  const buildParameters = requireObject(build, "parameters", `${sourceLabel}.build`);

  const subhandleStrategy = requireObject(value, "subhandle_strategy", sourceLabel);
  const namespace = requireString(
    subhandleStrategy,
    "namespace",
    `${sourceLabel}.subhandle_strategy`
  );
  const format = requireString(
    subhandleStrategy,
    "format",
    `${sourceLabel}.subhandle_strategy`
  );
  if (!ALLOWED_SUBHANDLE_FORMATS.has(format)) {
    throw new Error(
      `${sourceLabel}.subhandle_strategy format must be contract_slug_ordinal`
    );
  }

  const settings = requireObject(value, "settings", sourceLabel);
  const settingsType = requireString(settings, "type", `${sourceLabel}.settings`);
  const settingsValues = parseSettingsValues(
    requireObject(settings, "values", `${sourceLabel}.settings`),
    `${sourceLabel}.settings.values`
  );

  return {
    schemaVersion: 1,
    network,
    contractSlug,
    build: {
      target: buildTarget,
      kind: buildKind,
      parameters: buildParameters,
    },
    subhandleStrategy: {
      namespace,
      format,
    },
    settings: {
      type: settingsType,
      values: settingsValues,
    },
  };
};

const parseSettingsValues = (value, sourceLabel) => {
  const normalized = {};
  for (const key of PERSONALIZATION_SETTINGS_KEYS) {
    normalized[key] = requireString(value, key, sourceLabel);
  }
  return normalized;
};

const requireObject = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include object field \`${key}\``);
  }
  return resolved;
};

const requireString = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw new Error(`${sourceLabel} must include string field \`${key}\``);
  }
  return resolved.trim();
};

const requireNumber = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (typeof resolved !== "number" || Number.isNaN(resolved)) {
    throw new Error(`${sourceLabel} must include numeric field \`${key}\``);
  }
  return resolved;
};

export { PERSONALIZATION_SETTINGS_KEYS };

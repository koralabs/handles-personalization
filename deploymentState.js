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

export const PERSONALIZATION_SETTINGS_HANDLES = [
  "pz_settings",
  "bg_policy_ids",
  "pfp_policy_ids",
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
  rejectObservedOnly(value, sourceLabel);

  const schemaVersion = requireNumber(value, "schema_version", sourceLabel);
  if (schemaVersion !== 3) {
    throw new Error(`${sourceLabel} schema_version must equal 3`);
  }

  const network = requireString(value, "network", sourceLabel);
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

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

  const contractsRaw = value.contracts;
  if (!Array.isArray(contractsRaw) || contractsRaw.length === 0) {
    throw new Error(`${sourceLabel} must include non-empty array field \`contracts\``);
  }
  const contracts = contractsRaw.map((entry, index) =>
    parseContract(entry, `${sourceLabel}.contracts[${index}]`)
  );
  const slugs = contracts.map((c) => c.contractSlug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error(`${sourceLabel}.contracts must have unique contract_slug values`);
  }

  const assignedHandles = requireObject(value, "assigned_handles", sourceLabel);
  const settings = requireObject(value, "settings", sourceLabel);

  return {
    schemaVersion: 3,
    network,
    subhandleStrategy: { namespace, format },
    contracts,
    assignedHandles: {
      settings: requireStringArrayAllowEmpty(
        assignedHandles,
        "settings",
        `${sourceLabel}.assigned_handles`
      ),
      scripts: requireStringArrayAllowEmpty(
        assignedHandles,
        "scripts",
        `${sourceLabel}.assigned_handles`
      ),
    },
    ignoredSettings: requireStringArrayAllowEmpty(
      value,
      "ignored_settings",
      sourceLabel
    ),
    settings: {
      type: requireString(settings, "type", `${sourceLabel}.settings`),
      values: parseSettingsValues(
        requireObject(settings, "values", `${sourceLabel}.settings.values`),
        `${sourceLabel}.settings.values`
      ),
    },
  };
};

const rejectObservedOnly = (value, sourceLabel) => {
  const observedOnlyField = Object.keys(value).find((key) =>
    OBSERVED_ONLY_FIELDS.has(key)
  );
  if (observedOnlyField) {
    throw new Error(
      `${sourceLabel} must not include observed-only field \`${observedOnlyField}\``
    );
  }
};

const parseContract = (value, sourceLabel) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceLabel} must be a YAML object`);
  }
  rejectObservedOnly(value, sourceLabel);

  const contractSlug = requireShortHandleSlug(value, "contract_slug", sourceLabel);
  const scriptType = requireShortHandleSlug(value, "script_type", sourceLabel);
  const deploymentHandleSlug = requireShortHandleSlug(
    value,
    "deployment_handle_slug",
    sourceLabel
  );
  if (contractSlug !== scriptType || scriptType !== deploymentHandleSlug) {
    throw new Error(
      `${sourceLabel} contract_slug, script_type, and deployment_handle_slug must match`
    );
  }
  const build = requireObject(value, "build", sourceLabel);
  const buildTarget = requireString(build, "target", `${sourceLabel}.build`);
  const buildKind = requireString(build, "kind", `${sourceLabel}.build`);
  if (!ALLOWED_BUILD_KINDS.has(buildKind)) {
    throw new Error(`${sourceLabel}.build kind must be validator or minting_policy`);
  }
  const buildParameters = requireObject(build, "parameters", `${sourceLabel}.build`);

  return {
    contractSlug,
    scriptType,
    oldScriptType: requireOptionalScriptType(value, "old_script_type", sourceLabel),
    deploymentHandleSlug,
    build: {
      target: buildTarget,
      kind: buildKind,
      parameters: buildParameters,
    },
  };
};

const parseSettingsValues = (value, sourceLabel) => ({
  pz_settings: parsePzSettings(
    requireObject(value, "pz_settings", sourceLabel),
    `${sourceLabel}.pz_settings`
  ),
});

const parsePzSettings = (value, sourceLabel) => ({
  treasury_fee: requireNumber(value, "treasury_fee", sourceLabel),
  treasury_cred: requireString(value, "treasury_cred", sourceLabel),
  pz_min_fee: requireNumber(value, "pz_min_fee", sourceLabel),
  pz_providers: requireStringRecord(value, "pz_providers", sourceLabel),
  valid_contracts: requireStringArrayAllowEmpty(value, "valid_contracts", sourceLabel),
  admin_creds: requireStringArrayAllowEmpty(value, "admin_creds", sourceLabel),
  settings_cred: requireString(value, "settings_cred", sourceLabel),
  grace_period: requireNumber(value, "grace_period", sourceLabel),
  subhandle_share_percent: requireNumber(value, "subhandle_share_percent", sourceLabel),
});

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

const requireStringRecord = (value, key, sourceLabel) => {
  const resolved = requireObject(value, key, sourceLabel);
  return Object.fromEntries(
    Object.entries(resolved)
      .map(([entryKey, entryValue]) => {
        if (typeof entryValue !== "string" || entryValue.trim() === "") {
          throw new Error(`${sourceLabel}.${key} must include string values`);
        }
        return [entryKey.trim(), entryValue.trim()];
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
};

const requireStringArrayAllowEmpty = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (!Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include array field \`${key}\``);
  }
  return resolved.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`${sourceLabel} must include string array field \`${key}\``);
    }
    return item.trim();
  });
};

const requireShortHandleSlug = (value, key, sourceLabel) => {
  const resolved = requireString(value, key, sourceLabel);
  if (resolved.length > 10) {
    throw new Error(`${sourceLabel}.${key} must be 10 characters or fewer`);
  }
  if (resolved.includes("-")) {
    throw new Error(`${sourceLabel}.${key} must not include "-"`);
  }
  return resolved;
};

const requireOptionalScriptType = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (resolved === undefined || resolved === null) {
    return null;
  }
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw new Error(`${sourceLabel} must include string field \`${key}\``);
  }
  return resolved.trim();
};

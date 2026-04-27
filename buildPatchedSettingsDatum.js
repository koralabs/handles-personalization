// Patches the existing pz_settings inline datum with values from a desired
// state YAML. Unchanged fields keep their decoded buffers verbatim; only
// the differing fields are mutated. The whole 9-field list is then
// re-encoded as canonical CBOR and returned as a hex string.
//
// This mirrors the pattern in scripts/build_pz_settings_cred_refresh.js
// (which patches a single field in place) but generalized to the full
// pz_settings shape so the deployment-plan workflow can emit settings-only
// txs for any desired state change.

import cbor from "cbor";

const FIELD_NAMES = [
  "treasury_fee",
  "treasury_cred",
  "pz_min_fee",
  "pz_providers",
  "valid_contracts",
  "admin_creds",
  "settings_cred",
  "grace_period",
  "subhandle_share_percent",
];

const toBuf = (hex) => Buffer.from(stripHex(hex), "hex");
const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);
const bufHex = (b) => Buffer.from(b).toString("hex");

const numEq = (a, b) => BigInt(a) === BigInt(b);
const hexEq = (a, b) => stripHex(String(a)) === bufHex(b);

const buildProvidersMap = (desired) => {
  const map = new Map();
  for (const [k, v] of Object.entries(desired)) {
    map.set(toBuf(k), toBuf(v));
  }
  return map;
};

const providersEqual = (currentMap, desiredObj) => {
  if (!(currentMap instanceof Map)) return false;
  const keys = Object.keys(desiredObj);
  if (currentMap.size !== keys.length) return false;
  for (const [k, v] of currentMap.entries()) {
    const expected = desiredObj[bufHex(k)];
    if (expected === undefined) return false;
    if (!hexEq(expected, v)) return false;
  }
  return true;
};

const listEqual = (currentList, desiredList) => {
  if (!Array.isArray(currentList)) return false;
  if (currentList.length !== desiredList.length) return false;
  for (let i = 0; i < desiredList.length; i += 1) {
    if (!hexEq(desiredList[i], currentList[i])) return false;
  }
  return true;
};

export const buildPatchedSettingsDatum = (currentDatumHex, desiredPzSettings) => {
  const decoded = cbor.decodeFirstSync(Buffer.from(stripHex(currentDatumHex), "hex"));
  if (!Array.isArray(decoded) || decoded.length !== 9) {
    throw new Error(`pz_settings datum is not a 9-element list (got ${Array.isArray(decoded) ? decoded.length : typeof decoded})`);
  }
  const fields = [...decoded];
  const changeLog = [];

  if (!numEq(desiredPzSettings.treasury_fee, fields[0])) {
    changeLog.push(`treasury_fee: ${fields[0]} -> ${desiredPzSettings.treasury_fee}`);
    fields[0] = BigInt(desiredPzSettings.treasury_fee);
  }

  if (!hexEq(desiredPzSettings.treasury_cred, fields[1])) {
    changeLog.push(`treasury_cred: ${bufHex(fields[1])} -> ${stripHex(desiredPzSettings.treasury_cred)}`);
    fields[1] = toBuf(desiredPzSettings.treasury_cred);
  }

  if (!numEq(desiredPzSettings.pz_min_fee, fields[2])) {
    changeLog.push(`pz_min_fee: ${fields[2]} -> ${desiredPzSettings.pz_min_fee}`);
    fields[2] = BigInt(desiredPzSettings.pz_min_fee);
  }

  if (!providersEqual(fields[3], desiredPzSettings.pz_providers)) {
    changeLog.push(`pz_providers: changed`);
    fields[3] = buildProvidersMap(desiredPzSettings.pz_providers);
  }

  if (!listEqual(fields[4], desiredPzSettings.valid_contracts)) {
    changeLog.push(`valid_contracts: ${fields[4]?.length ?? 0} -> ${desiredPzSettings.valid_contracts.length}`);
    fields[4] = desiredPzSettings.valid_contracts.map(toBuf);
  }

  if (!listEqual(fields[5], desiredPzSettings.admin_creds)) {
    changeLog.push(`admin_creds: ${fields[5]?.length ?? 0} -> ${desiredPzSettings.admin_creds.length}`);
    fields[5] = desiredPzSettings.admin_creds.map(toBuf);
  }

  if (!hexEq(desiredPzSettings.settings_cred, fields[6])) {
    changeLog.push(`settings_cred: ${bufHex(fields[6])} -> ${stripHex(desiredPzSettings.settings_cred)}`);
    fields[6] = toBuf(desiredPzSettings.settings_cred);
  }

  if (!numEq(desiredPzSettings.grace_period, fields[7])) {
    changeLog.push(`grace_period: ${fields[7]} -> ${desiredPzSettings.grace_period}`);
    fields[7] = BigInt(desiredPzSettings.grace_period);
  }

  if (!numEq(desiredPzSettings.subhandle_share_percent, fields[8])) {
    changeLog.push(`subhandle_share_percent: ${fields[8]} -> ${desiredPzSettings.subhandle_share_percent}`);
    fields[8] = BigInt(desiredPzSettings.subhandle_share_percent);
  }

  // No-op short-circuit: the live datum often uses indefinite-length CBOR
  // (9f..ff) while cbor.encode emits definite-length. Without this guard,
  // a patch that touches no fields would still mutate the bytes purely
  // due to re-encoding, producing a phantom diff in the change log.
  if (changeLog.length === 0) {
    return {
      newDatumHex: stripHex(currentDatumHex),
      changeLog,
      fieldNames: FIELD_NAMES,
    };
  }

  return {
    newDatumHex: cbor.encode(fields).toString("hex"),
    changeLog,
    fieldNames: FIELD_NAMES,
  };
};

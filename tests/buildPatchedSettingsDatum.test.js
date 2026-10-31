import assert from "node:assert/strict";
import test from "node:test";
import cbor from "cbor";
import { buildPatchedSettingsDatum } from "../buildPatchedSettingsDatum.js";

const HEX_28 = (byte) => byte.repeat(56);

const baseSettings = {
  treasury_fee: 1500000,
  treasury_cred: HEX_28("aa"),
  pz_min_fee: 1500000,
  pz_providers: {
    [HEX_28("11")]: HEX_28("22"),
    [HEX_28("33")]: HEX_28("44"),
  },
  valid_contracts: [HEX_28("55"), HEX_28("66")],
  admin_creds: [HEX_28("77")],
  settings_cred: HEX_28("88"),
  grace_period: 3600000,
  subhandle_share_percent: 50,
  persdsg_hashes: [HEX_28("99")],
};

// Encode a settings object into the canonical on-chain shape: a 10-field CBOR list
// with bytestrings/integers/maps/lists for the corresponding slots.
const encodeAsLiveDatum = (s) => {
  const buf = (h) => Buffer.from(h, "hex");
  const fields = [
    BigInt(s.treasury_fee),
    buf(s.treasury_cred),
    BigInt(s.pz_min_fee),
    new Map(Object.entries(s.pz_providers).map(([k, v]) => [buf(k), buf(v)])),
    s.valid_contracts.map(buf),
    s.admin_creds.map(buf),
    buf(s.settings_cred),
    BigInt(s.grace_period),
    BigInt(s.subhandle_share_percent),
    s.persdsg_hashes.map(buf),
  ];
  return cbor.encode(fields).toString("hex");
};

const decodeFields = (hex) => cbor.decodeFirstSync(Buffer.from(hex, "hex"));

test("returns no change log when desired matches the live datum", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, baseSettings);
  assert.deepEqual(changeLog, []);
  assert.equal(newDatumHex, live);
});

test("appends a hash to valid_contracts and re-encodes only that field", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = {
    ...baseSettings,
    valid_contracts: [...baseSettings.valid_contracts, HEX_28("99")],
  };
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, desired);
  assert.equal(changeLog.length, 1);
  assert.match(changeLog[0], /^valid_contracts: 2 -> 3/);

  const decoded = decodeFields(newDatumHex);
  assert.equal(decoded.length, 10);
  assert.equal(decoded[4].length, 3);
  assert.equal(Buffer.from(decoded[4][2]).toString("hex"), HEX_28("99"));
  // Other fields untouched.
  assert.equal(Buffer.from(decoded[1]).toString("hex"), baseSettings.treasury_cred);
  assert.equal(Buffer.from(decoded[6]).toString("hex"), baseSettings.settings_cred);
});

test("patches a single integer field without touching neighbors", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = { ...baseSettings, grace_period: 7200000 };
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, desired);
  assert.equal(changeLog.length, 1);
  assert.match(changeLog[0], /^grace_period:/);

  const decoded = decodeFields(newDatumHex);
  assert.equal(BigInt(decoded[7]), 7200000n);
  assert.equal(BigInt(decoded[8]), 50n);
});

test("patches the pz_providers map shape change", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = {
    ...baseSettings,
    pz_providers: { [HEX_28("aa")]: HEX_28("bb") },
  };
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, desired);
  assert.deepEqual(changeLog, ["pz_providers: changed"]);

  const decoded = decodeFields(newDatumHex);
  const map = decoded[3];
  assert.equal(map.size, 1);
  const entries = Array.from(map.entries());
  assert.equal(Buffer.from(entries[0][0]).toString("hex"), HEX_28("aa"));
  assert.equal(Buffer.from(entries[0][1]).toString("hex"), HEX_28("bb"));
});

test("patches the settings_cred byte string and reports old vs new", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = { ...baseSettings, settings_cred: HEX_28("ee") };
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, desired);
  assert.equal(changeLog.length, 1);
  assert.equal(
    changeLog[0],
    `settings_cred: ${HEX_28("88")} -> ${HEX_28("ee")}`
  );

  const decoded = decodeFields(newDatumHex);
  assert.equal(Buffer.from(decoded[6]).toString("hex"), HEX_28("ee"));
});

test("rejects a datum that is not a 9- or 10-element list", () => {
  const garbage = cbor.encode([1, 2, 3]).toString("hex");
  assert.throws(() => buildPatchedSettingsDatum(garbage, baseSettings), /9- or 10-element list/);
});

test("emits multiple change-log entries when several fields differ", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = {
    ...baseSettings,
    treasury_fee: 2_000_000,
    valid_contracts: [...baseSettings.valid_contracts, HEX_28("99")],
    settings_cred: HEX_28("ee"),
  };
  const { changeLog } = buildPatchedSettingsDatum(live, desired);
  assert.equal(changeLog.length, 3);
  assert.ok(changeLog.some((s) => s.startsWith("treasury_fee:")));
  assert.ok(changeLog.some((s) => s.startsWith("valid_contracts:")));
  assert.ok(changeLog.some((s) => s.startsWith("settings_cred:")));
});

test("handles a 0x-prefixed hex string the way the YAML stores them", () => {
  const live = encodeAsLiveDatum(baseSettings);
  const desired = { ...baseSettings, settings_cred: `0x${HEX_28("ee")}` };
  const { newDatumHex } = buildPatchedSettingsDatum(live, desired);
  const decoded = decodeFields(newDatumHex);
  assert.equal(Buffer.from(decoded[6]).toString("hex"), HEX_28("ee"));
});

// Invariant: every settings field is patched on its own: exactly one change-log entry names it and no other slot of the datum changes.
// Negative control: removing any field's branch in buildPatchedSettingsDatum makes that case return an empty change log.
const FIELD_CASES = [
  ["treasury_fee", 0, 2_000_000],
  ["treasury_cred", 1, HEX_28("ab")],
  ["pz_min_fee", 2, 2_500_000],
  ["admin_creds", 5, [HEX_28("77"), HEX_28("78")]],
  ["subhandle_share_percent", 8, 60],
  ["persdsg_hashes", 9, []],
];
for (const [name, slot, value] of FIELD_CASES) {
  test(`patches only ${name} (slot ${slot}) when it alone differs`, () => {
    const live = encodeAsLiveDatum(baseSettings);
    const { newDatumHex, changeLog } = buildPatchedSettingsDatum(live, { ...baseSettings, [name]: value });
    assert.equal(changeLog.length, 1);
    assert.ok(changeLog[0].startsWith(`${name}:`), changeLog[0]);
    const before = decodeFields(live);
    const after = decodeFields(newDatumHex);
    for (let i = 0; i < before.length; i++) {
      const same = Buffer.compare(cbor.encode(before[i]), cbor.encode(after[i])) === 0;
      assert.equal(same, i !== slot, `slot ${i}`);
    }
  });
}

test("accepts a 9-field legacy datum and adds persdsg_hashes", () => {
  const legacy = cbor.encode(decodeFields(encodeAsLiveDatum(baseSettings)).slice(0, 9)).toString("hex");
  const { newDatumHex, changeLog } = buildPatchedSettingsDatum(legacy, baseSettings);
  assert.deepEqual(changeLog, ["persdsg_hashes: 0 -> 1"]);
  assert.equal(decodeFields(newDatumHex).length, 10);
});

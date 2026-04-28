import assert from "node:assert/strict";
import test from "node:test";

import cbor from "cbor";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";

const HEX_28 = (byte) => byte.repeat(56);

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const PREFIX_222 = "000de140";
const SCRIPT_ADDRESS = "addr_test1xp5gahy5jpx99p4vtnq2mfsmnjz84rfrqxyznqewp62mzy2tqcwlsq95pxz027092fzsjgpfzzaunne0qa9glmj38dfqafd0cf";
const NATIVE_SCRIPT_CBOR_HEX = "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b8200581cd9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d";

const SETTINGS_UTXO_TX_HASH = "1111111111111111111111111111111111111111111111111111111111111111";
const SETTINGS_UTXO_INDEX = 0;
const FUNDING_UTXO_TX_HASH = "2222222222222222222222222222222222222222222222222222222222222222";
const FUNDING_UTXO_INDEX = 0;

const buildLiveDatumHex = () => {
  const buf = (h) => Buffer.from(h, "hex");
  const fields = [
    1500000n,
    buf(HEX_28("aa")),
    1500000n,
    new Map([[buf(HEX_28("11")), buf(HEX_28("22"))]]),
    [buf(HEX_28("55"))],
    [buf(HEX_28("77"))],
    buf(HEX_28("88")),
    3600000n,
    50n,
  ];
  return cbor.encode(fields).toString("hex");
};

const buildPatchedDatumHex = () => {
  const buf = (h) => Buffer.from(h, "hex");
  const fields = [
    2500000n,
    buf(HEX_28("aa")),
    1500000n,
    new Map([[buf(HEX_28("11")), buf(HEX_28("22"))]]),
    [buf(HEX_28("55"))],
    [buf(HEX_28("77"))],
    buf(HEX_28("88")),
    3600000n,
    50n,
  ];
  return cbor.encode(fields).toString("hex");
};

const handleAssetUnit = (handleName) =>
  `${HANDLE_POLICY_ID}${PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`;

const PROTOCOL_PARAMS_RESPONSE = {
  a0: 0.3,
  coins_per_utxo_size: 4310,
  collateral_percent: 150,
  cost_models_raw: {
    PlutusV1: new Array(166).fill(0),
    PlutusV2: new Array(175).fill(0),
    PlutusV3: new Array(297).fill(0),
  },
  e_max: 18,
  key_deposit: 2000000,
  max_block_ex_mem: 62000000,
  max_block_ex_steps: 20000000000,
  max_block_header_size: 1100,
  max_block_size: 90112,
  max_collateral_inputs: 3,
  pool_deposit: 500000000,
  max_tx_ex_mem: 14000000,
  max_tx_ex_steps: 10000000000,
  max_tx_size: 16384,
  max_val_size: 5000,
  min_fee_a: 44,
  min_fee_b: 155381,
  min_fee_ref_script_cost_per_byte: 15,
  min_pool_cost: 170000000,
  n_opt: 500,
  price_mem: 0.0577,
  price_step: 0.0000721,
  protocol_major_ver: 10,
  protocol_minor_ver: 0,
  rho: 0.003,
  tau: 0.2,
};

const LATEST_BLOCK_RESPONSE = {
  hash: "0".repeat(64),
  epoch: 100,
  epoch_slot: 0,
  height: 1000000,
  slot: 70000000,
  time: 1700000000,
};

const GENESIS_RESPONSE = {
  active_slots_coefficient: 0.05,
  epoch_length: 432000,
  max_kes_evolutions: 62,
  max_lovelace_supply: "45000000000000000",
  network_magic: 2,
  security_param: 2160,
  slot_length: 1,
  slots_per_kes_period: 129600,
  system_start: 1666656000,
  update_quorum: 5,
};

const buildMockFetch = ({ liveDatumHex, settingsHandleName }) => {
  const handleAssetUnitHex = handleAssetUnit(settingsHandleName);
  return async (url) => {
    const u = String(url);
    if (u.includes(`handles/${encodeURIComponent(settingsHandleName)}`) && !u.includes("/datum")) {
      return new Response(
        JSON.stringify({
          name: settingsHandleName,
          utxo: `${SETTINGS_UTXO_TX_HASH}#${SETTINGS_UTXO_INDEX}`,
          resolved_addresses: { ada: SCRIPT_ADDRESS },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes(`/txs/${SETTINGS_UTXO_TX_HASH}/utxos`)) {
      return new Response(
        JSON.stringify({
          outputs: [
            {
              output_index: SETTINGS_UTXO_INDEX,
              tx_index: SETTINGS_UTXO_INDEX,
              amount: [
                { unit: "lovelace", quantity: "5000000" },
                { unit: handleAssetUnitHex, quantity: "1" },
              ],
              inline_datum: liveDatumHex,
              data_hash: null,
              reference_script_hash: null,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes(`/addresses/${SCRIPT_ADDRESS}/utxos`)) {
      // Page 1: a clean funding UTxO + the settings UTxO (filtered out as it has tokens).
      // Page 2: empty (terminate pagination).
      const isPage1 = u.includes("page=1");
      const items = isPage1
        ? [
            {
              tx_hash: FUNDING_UTXO_TX_HASH,
              tx_index: FUNDING_UTXO_INDEX,
              output_index: FUNDING_UTXO_INDEX,
              amount: [{ unit: "lovelace", quantity: "10000000" }],
              block: "0".repeat(64),
              data_hash: null,
              inline_datum: null,
              reference_script_hash: null,
            },
            {
              tx_hash: SETTINGS_UTXO_TX_HASH,
              tx_index: SETTINGS_UTXO_INDEX,
              output_index: SETTINGS_UTXO_INDEX,
              amount: [
                { unit: "lovelace", quantity: "5000000" },
                { unit: handleAssetUnitHex, quantity: "1" },
              ],
              block: "0".repeat(64),
              data_hash: null,
              inline_datum: liveDatumHex,
              reference_script_hash: null,
            },
          ]
        : [];
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/blocks/latest")) {
      return new Response(JSON.stringify(LATEST_BLOCK_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/genesis")) {
      return new Response(JSON.stringify(GENESIS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/epochs/latest/parameters")) {
      return new Response(JSON.stringify(PROTOCOL_PARAMS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(`unmocked URL: ${u}`, { status: 500 });
  };
};

const withMockedFetch = async (mockFetch, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
};

test("builds an unsigned settings-update tx with native script witness", async () => {
  const liveDatumHex = buildLiveDatumHex();
  const patchedDatumHex = buildPatchedDatumHex();
  const settingsHandleName = "pers@handle_settings";

  const mockFetch = buildMockFetch({ liveDatumHex, settingsHandleName });

  const result = await withMockedFetch(mockFetch, () =>
    buildSettingsUpdateTx({
      network: "preview",
      settingsHandleName,
      patchedDatumHex,
      nativeScriptCborHex: NATIVE_SCRIPT_CBOR_HEX,
      blockfrostApiKey: "preview-test-key",
      userAgent: "kora-test/1.0",
    })
  );

  assert.ok(result.cborHex && result.cborHex.length > 0, "expected non-empty cborHex");
  assert.ok(Buffer.isBuffer(result.cborBytes), "expected cborBytes Buffer");
  assert.equal(result.cborBytes.toString("hex"), result.cborHex);
  assert.ok(result.estimatedSignedTxSize > 0);
  assert.ok(result.estimatedSignedTxSize <= result.maxTxSize);
  assert.equal(result.scriptAddress, SCRIPT_ADDRESS);
  assert.equal(result.handleUtxoRef, `${SETTINGS_UTXO_TX_HASH}#${SETTINGS_UTXO_INDEX}`);

  // Decode the tx via cardano-sdk to handle Conway set tagging cleanly.
  const tx = Serialization.Transaction.fromCbor(result.cborHex);
  const txCore = tx.toCore();

  // Inputs: settings UTxO is always selected (it carries the asset we're
  // mutating). The funding UTxO joins only if the settings UTxO's lovelace is
  // insufficient to cover output + fee + change min-coin. With a 5-ADA
  // settings UTxO and a small datum, the input alone is enough.
  const inputRefs = txCore.body.inputs.map((txIn) => `${txIn.txId}#${txIn.index}`);
  assert.ok(inputRefs.length >= 1, `expected at least 1 input, got ${inputRefs.length}`);
  assert.ok(
    inputRefs.includes(`${SETTINGS_UTXO_TX_HASH}#${SETTINGS_UTXO_INDEX}`),
    "settings UTxO must be among inputs"
  );

  // Outputs: at least the patched settings output. Find the one carrying the
  // handle asset (input selector orders outputs deterministically but order is
  // not part of our contract).
  const settingsOutput = txCore.body.outputs.find((output) =>
    Boolean(output.value.assets?.size)
  );
  assert.ok(settingsOutput, "settings output (with handle asset) must be present");
  assert.ok(settingsOutput.datum, "settings output carries an inline datum");

  // Fee must be positive.
  assert.ok(txCore.body.fee > 0n, `expected positive fee, got ${txCore.body.fee}`);

  // Witness set: 1 native script, 0 vkey witnesses.
  assert.equal((txCore.witness.signatures?.size ?? 0), 0, "no vkey witnesses on the unsigned tx");
  assert.equal(txCore.witness.scripts?.length ?? 0, 1, "exactly one native script witness");

  // The on-chain datum must structurally equal the patched datum. Cardano-sdk
  // may re-encode lists from definite (89...) to indefinite (9f...ff) form, but
  // the Plutus value is unchanged. pz_settings is spent by a native-script
  // multisig (no byte-comparing Helios validator), and the personalization
  // validator reads pz_settings as a reference input via PzSettings::from_data
  // — both encodings deserialize identically.
  const onChainDatumCbor = Serialization.PlutusData.fromCore(settingsOutput.datum).toCbor();
  const onChainDecoded = cbor.decodeFirstSync(Buffer.from(onChainDatumCbor, "hex"));
  const patchedDecoded = cbor.decodeFirstSync(Buffer.from(patchedDatumHex, "hex"));
  assert.deepEqual(
    onChainDecoded,
    patchedDecoded,
    "on-chain datum must decode to the same Plutus data as the patched datum"
  );
});

test("rejects when no clean funding UTxOs exist at the script address", async () => {
  const liveDatumHex = buildLiveDatumHex();
  const settingsHandleName = "pers@handle_settings";

  const mockFetch = async (url) => {
    const u = String(url);
    const handleAssetUnitHex = handleAssetUnit(settingsHandleName);
    if (u.includes(`handles/${encodeURIComponent(settingsHandleName)}`) && !u.includes("/datum")) {
      return new Response(
        JSON.stringify({
          name: settingsHandleName,
          utxo: `${SETTINGS_UTXO_TX_HASH}#${SETTINGS_UTXO_INDEX}`,
          resolved_addresses: { ada: SCRIPT_ADDRESS },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes(`/txs/${SETTINGS_UTXO_TX_HASH}/utxos`)) {
      return new Response(
        JSON.stringify({
          outputs: [
            {
              output_index: SETTINGS_UTXO_INDEX,
              tx_index: SETTINGS_UTXO_INDEX,
              amount: [
                { unit: "lovelace", quantity: "5000000" },
                { unit: handleAssetUnitHex, quantity: "1" },
              ],
              inline_datum: liveDatumHex,
              data_hash: null,
              reference_script_hash: null,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes(`/addresses/${SCRIPT_ADDRESS}/utxos`)) {
      // Only the settings UTxO (with tokens) — no clean funding UTxO.
      const isPage1 = u.includes("page=1");
      const items = isPage1
        ? [
            {
              tx_hash: SETTINGS_UTXO_TX_HASH,
              tx_index: SETTINGS_UTXO_INDEX,
              output_index: SETTINGS_UTXO_INDEX,
              amount: [
                { unit: "lovelace", quantity: "5000000" },
                { unit: handleAssetUnitHex, quantity: "1" },
              ],
              block: "0".repeat(64),
              data_hash: null,
              inline_datum: liveDatumHex,
              reference_script_hash: null,
            },
          ]
        : [];
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/blocks/latest")) {
      return new Response(JSON.stringify(LATEST_BLOCK_RESPONSE), { status: 200 });
    }
    if (u.endsWith("/genesis")) {
      return new Response(JSON.stringify(GENESIS_RESPONSE), { status: 200 });
    }
    if (u.endsWith("/epochs/latest/parameters")) {
      return new Response(JSON.stringify(PROTOCOL_PARAMS_RESPONSE), { status: 200 });
    }
    return new Response(`unmocked URL: ${u}`, { status: 500 });
  };

  await withMockedFetch(mockFetch, async () => {
    await assert.rejects(
      buildSettingsUpdateTx({
        network: "preview",
        settingsHandleName,
        patchedDatumHex: buildPatchedDatumHex(),
        nativeScriptCborHex: NATIVE_SCRIPT_CBOR_HEX,
        blockfrostApiKey: "preview-test-key",
        userAgent: "kora-test/1.0",
      }),
      /no clean .*UTxOs at script address/
    );
  });
});

test("rejects when required arguments are missing", async () => {
  await assert.rejects(
    buildSettingsUpdateTx({
      network: "preview",
      settingsHandleName: "pers@handle_settings",
      patchedDatumHex: "deadbeef",
      blockfrostApiKey: "preview-test-key",
      userAgent: "kora-test/1.0",
    }),
    /nativeScriptCborHex is required/
  );
});

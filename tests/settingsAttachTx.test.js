import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import cbor from "cbor";

import { buildSettingsAttachTx } from "../settingsAttachTx.js";
import { Cardano, Serialization } from "../helpers/cardano-sdk/index.js";

const HEX_28 = (byte) => byte.repeat(56);

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const PREFIX_222 = "000de140";
const MULTISIG_ADDRESS =
  "addr_test1xp5gahy5jpx99p4vtnq2mfsmnjz84rfrqxyznqewp62mzy2tqcwlsq95pxz027092fzsjgpfzzaunne0qa9glmj38dfqafd0cf";
const DEPLOYER_ADDRESS =
  "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej";

const buildPzSettingsDatumHex = () => {
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

const handleAssetUnit = (handleName) =>
  `${HANDLE_POLICY_ID}${PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`;

// Build a Cardano-standard TransactionUnspentOutput CBOR using cardano-sdk so
// the test consumes exactly what production would. Asset units default to a
// single handle token + the requested lovelace.
const buildCborUtxo = ({ txHash, index, address, lovelace, assetUnit, assetQuantity }) => {
  let assets;
  if (assetUnit) {
    const assetId = Cardano.AssetId.fromParts(
      Cardano.PolicyId(assetUnit.slice(0, 56)),
      Cardano.AssetName(assetUnit.slice(56))
    );
    assets = new Map([[assetId, BigInt(assetQuantity ?? 1)]]);
  }
  const txIn = { txId: txHash, index, address };
  const txOut = {
    address,
    value: { coins: BigInt(lovelace), ...(assets ? { assets } : {}) },
  };
  return Serialization.TransactionUnspentOutput.fromCore([txIn, txOut]).toCbor();
};

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

const buildBlockfrostMockFetch = () => async (url) => {
  const u = String(url);
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

const withMockedFetch = async (mockFetch, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
};

test("builds an unsigned datum-attach tx for a freshly minted settings handle", async () => {
  const handleName = "pers@handle_settings";
  const inlineDatumHex = buildPzSettingsDatumHex();

  const handleUtxoCbor = buildCborUtxo({
    txHash: "1".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 5_000_000,
    assetUnit: handleAssetUnit(handleName),
    assetQuantity: 1,
  });
  const fundingUtxoCbor = buildCborUtxo({
    txHash: "2".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 10_000_000,
  });

  const result = await withMockedFetch(buildBlockfrostMockFetch(), () =>
    buildSettingsAttachTx({
      network: "preview",
      handleName,
      inlineDatumHex,
      multisigAddress: MULTISIG_ADDRESS,
      deployerAddress: DEPLOYER_ADDRESS,
      cborUtxos: [handleUtxoCbor, fundingUtxoCbor],
      blockfrostApiKey: "preview-test-key",
    })
  );

  assert.equal(result.handleName, handleName);
  assert.equal(result.multisigAddress, MULTISIG_ADDRESS);
  assert.equal(result.handleUtxoRef, `${"1".repeat(64)}#0`);
  assert.ok(result.estimatedSignedTxSize > 0);
  assert.ok(result.estimatedSignedTxSize <= result.maxTxSize);

  const tx = Serialization.Transaction.fromCbor(result.cborHex).toCore();
  // The freshly minted handle UTxO must be among the inputs.
  const inputRefs = tx.body.inputs.map((i) => `${i.txId}#${i.index}`);
  assert.ok(
    inputRefs.includes(`${"1".repeat(64)}#0`),
    "handle UTxO must be consumed"
  );

  // The output carrying the handle asset goes to the multisig address with
  // the inline datum attached.
  const settingsOutput = tx.body.outputs.find((o) => Boolean(o.value.assets?.size));
  assert.ok(settingsOutput, "settings output must exist");
  assert.equal(String(settingsOutput.address), MULTISIG_ADDRESS);
  assert.ok(settingsOutput.datum, "settings output carries an inline datum");

  // No vkey witnesses on the unsigned tx; no native script (output-only,
  // input is a wallet UTxO).
  assert.equal(tx.witness.signatures?.size ?? 0, 0);
  assert.equal(tx.witness.scripts?.length ?? 0, 0);

  // Datum decodes to the same Plutus value we passed in.
  const onChainDatumCbor = Serialization.PlutusData.fromCore(settingsOutput.datum).toCbor();
  const onChainDecoded = cbor.decodeFirstSync(Buffer.from(onChainDatumCbor, "hex"));
  const inputDecoded = cbor.decodeFirstSync(Buffer.from(inlineDatumHex, "hex"));
  assert.deepEqual(onChainDecoded, inputDecoded);
});

test("rejects when the deployer wallet does not hold the handle", async () => {
  const fundingOnly = buildCborUtxo({
    txHash: "3".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 10_000_000,
  });

  await withMockedFetch(buildBlockfrostMockFetch(), () =>
    assert.rejects(
      buildSettingsAttachTx({
        network: "preview",
        handleName: "pers@handle_settings",
        inlineDatumHex: buildPzSettingsDatumHex(),
        multisigAddress: MULTISIG_ADDRESS,
        deployerAddress: DEPLOYER_ADDRESS,
        cborUtxos: [fundingOnly],
        blockfrostApiKey: "preview-test-key",
      }),
      /mint the handle first/
    )
  );
});

test("rejects when required arguments are missing", async () => {
  await assert.rejects(
    buildSettingsAttachTx({
      network: "preview",
      handleName: "pers@handle_settings",
      inlineDatumHex: "deadbeef",
      multisigAddress: MULTISIG_ADDRESS,
      deployerAddress: DEPLOYER_ADDRESS,
      cborUtxos: [],
      blockfrostApiKey: "preview-test-key",
    }),
    /non-empty cborUtxos is required/
  );
});

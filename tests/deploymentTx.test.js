import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceScriptDeploymentTx,
  fetchNetworkParameters,
} from "../deploymentTx.js";
import { Cardano, Serialization } from "../helpers/cardano-sdk/index.js";

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const PREFIX_222 = "000de140";
const DEPLOYER_ADDRESS =
  "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej";
const MULTISIG_ADDRESS =
  "addr_test1xp5gahy5jpx99p4vtnq2mfsmnjz84rfrqxyznqewp62mzy2tqcwlsq95pxz027092fzsjgpfzzaunne0qa9glmj38dfqafd0cf";

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

const handleAssetUnit = (handleName) =>
  `${HANDLE_POLICY_ID}${PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`;

const buildCborUtxo = ({
  txHash,
  index,
  address,
  lovelace,
  assetUnit,
  assetQuantity = 1,
}) => {
  let assets;
  if (assetUnit) {
    const assetId = Cardano.AssetId.fromParts(
      Cardano.PolicyId(assetUnit.slice(0, 56)),
      Cardano.AssetName(assetUnit.slice(56))
    );
    assets = new Map([[assetId, BigInt(assetQuantity)]]);
  }
  return Serialization.TransactionUnspentOutput.fromCore([
    { txId: txHash, index, address },
    { address, value: { coins: BigInt(lovelace), ...(assets ? { assets } : {}) } },
  ]).toCbor();
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

test("fetchNetworkParameters returns the deployment planner protocol surface", async () => {
  const params = await withMockedFetch(buildBlockfrostMockFetch(), () =>
    fetchNetworkParameters("preview", "preview-test-key")
  );

  assert.deepEqual(params, { maxTxSize: 16384 });
});

test("fetchNetworkParameters rejects a missing Blockfrost key", async () => {
  await assert.rejects(
    fetchNetworkParameters("preview", ""),
    /blockfrostApiKey is required/
  );
});

test("builds unsigned reference-script deployment tx for the selected handle", async () => {
  const handleName = "perspz1@handlecontract";
  const handleUtxoCbor = buildCborUtxo({
    txHash: "1".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 5_000_000,
    assetUnit: handleAssetUnit(handleName),
  });
  const fundingUtxoCbor = buildCborUtxo({
    txHash: "2".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 30_000_000,
  });

  const result = await withMockedFetch(buildBlockfrostMockFetch(), () =>
    buildReferenceScriptDeploymentTx({
      network: "preview",
      contractSlug: "perspz",
      handleName,
      changeAddress: DEPLOYER_ADDRESS,
      targetAddress: MULTISIG_ADDRESS,
      cborUtxos: [handleUtxoCbor, fundingUtxoCbor],
      blockfrostApiKey: "preview-test-key",
      loadProgramCborFn: () => "4100",
      inputRefScriptBytes: 10,
    })
  );

  assert.equal(result.contractSlug, "perspz");
  assert.equal(result.handleUtxoRef, `${"1".repeat(64)}#0`);
  assert.ok(result.consumedInputs.has(`${"1".repeat(64)}#0`));
  assert.ok(result.estimatedSignedTxSize > 0);
  assert.ok(result.estimatedSignedTxSize <= result.maxTxSize);

  const tx = Serialization.Transaction.fromCbor(result.cborHex).toCore();
  assert.equal(tx.witness.signatures?.size ?? 0, 0);

  const inputRefs = tx.body.inputs.map((input) => `${input.txId}#${input.index}`);
  assert.ok(inputRefs.includes(`${"1".repeat(64)}#0`), "handle UTxO must be consumed");

  const handleOutput = tx.body.outputs.find((output) => Boolean(output.value.assets?.size));
  assert.ok(handleOutput, "reference-script handle output must exist");
  assert.equal(String(handleOutput.address), MULTISIG_ADDRESS);
  assert.ok(handleOutput.scriptReference, "handle output carries the new reference script");

  const script = handleOutput.scriptReference;
  assert.equal(script.__type, "plutus");
  assert.equal(script.version, 2);
  assert.equal(script.bytes, "4100");
});

test("reference-script deployment tx rejects missing deployment handle UTxO", async () => {
  const fundingOnly = buildCborUtxo({
    txHash: "3".repeat(64),
    index: 0,
    address: DEPLOYER_ADDRESS,
    lovelace: 30_000_000,
  });

  await withMockedFetch(buildBlockfrostMockFetch(), () =>
    assert.rejects(
      buildReferenceScriptDeploymentTx({
        network: "preview",
        contractSlug: "perspz",
        handleName: "perspz1@handlecontract",
        changeAddress: DEPLOYER_ADDRESS,
        cborUtxos: [fundingOnly],
        blockfrostApiKey: "preview-test-key",
        loadProgramCborFn: () => "4100",
      }),
      /don't have \$perspz1@handlecontract handle/
    )
  );
});

test("reference-script deployment tx validates required arguments", async () => {
  await assert.rejects(
    buildReferenceScriptDeploymentTx({
      network: "preview",
      contractSlug: "perspz",
      handleName: "perspz1@handlecontract",
      changeAddress: DEPLOYER_ADDRESS,
      cborUtxos: [],
      blockfrostApiKey: "preview-test-key",
      loadProgramCborFn: () => "4100",
    }),
    /non-empty cborUtxos is required/
  );
});

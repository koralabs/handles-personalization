import { Buffer } from "node:buffer";

import { roundRobinRandomImprove } from "@cardano-sdk/input-selection";
import {
  computeMinimumCoinQuantity,
  createTransactionInternals,
  defaultSelectionConstraints,
  GreedyTxEvaluator,
} from "@cardano-sdk/tx-construction";

import { fetchBlockfrostUtxos, fetchBlockfrostTxOutput } from "./helpers/cardano-sdk/blockfrostUtxo.js";
import { getBlockfrostBuildContext } from "./helpers/cardano-sdk/blockfrostContext.js";
import {
  asPaymentAddress,
  buildPlaceholderSignatures,
  Cardano,
  Serialization,
  transactionHashFromCore,
  transactionToCbor,
} from "./helpers/cardano-sdk/index.js";

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const PREFIX_222 = "000de140";

// cardano-sdk's defaultSelectionConstraints.computeMinimumCost undershoots the
// node's computed min fee by ~4 bytes (~176 lovelace) when the witness set
// contains a native script. Mirrors decentralized-minting/src/deploymentTx.ts:
// applying the bump inside computeMinimumCost (rather than after selection)
// keeps the inputs = outputs + fee invariant intact.
const NATIVE_SCRIPT_FEE_SAFETY_MARGIN_LOVELACE = 2000n;

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);

const parseNativeScript = (cborHex) =>
  Serialization.NativeScript.fromCbor(stripHex(cborHex)).toCore();

const toUtxoRef = (utxo) => `${utxo[0].txId}#${utxo[0].index}`;

const resolveSettingsHandleUtxo = async ({
  network,
  handleName,
  blockfrostApiKey,
  userAgent,
  fetchFn = fetch,
}) => {
  // The api's /handles/<name> response can lag chain by hours-to-days
  // for low-traffic settings handles (the api scanner doesn't index every
  // UTxO move equally fast, especially for tokens that rarely change).
  // We use the api ONLY for `resolved_addresses.ada` (the script address);
  // the actual current UTxO holding the LBL_222 token is resolved by
  // querying Blockfrost's asset-addresses endpoint, which is chain-truthy.
  const apiBase = handlesApiBaseUrlForNetwork(network);
  const handleResponse = await fetchFn(
    `${apiBase}/handles/${encodeURIComponent(handleName)}`,
    { headers: { "User-Agent": userAgent } }
  );
  if (!handleResponse.ok) {
    throw new Error(`failed to look up handle ${handleName}: HTTP ${handleResponse.status}`);
  }
  const handleData = await handleResponse.json();
  const handleAddress = handleData.resolved_addresses?.ada;
  if (!handleAddress) {
    throw new Error(`handle ${handleName} has no resolved ADA address`);
  }

  // Resolve current LBL_222 UTxO via Blockfrost. Chain-truthy.
  const handleHexInner = Buffer.from(handleName, "utf8").toString("hex");
  const assetUnit = `${HANDLE_POLICY_ID}${PREFIX_222}${handleHexInner}`;
  const assetTxsUrl = `https://cardano-${network}.blockfrost.io/api/v0/assets/${assetUnit}/transactions?order=desc&count=1`;
  const assetTxsResponse = await fetchFn(assetTxsUrl, {
    headers: { project_id: blockfrostApiKey },
  });
  if (!assetTxsResponse.ok) {
    throw new Error(`failed to look up handle ${handleName} asset txs: HTTP ${assetTxsResponse.status}`);
  }
  const assetTxs = await assetTxsResponse.json();
  if (!Array.isArray(assetTxs) || assetTxs.length === 0) {
    throw new Error(`handle ${handleName} asset has no on-chain history`);
  }
  // Walk the asset's tx history, newest first, and pick the first tx
  // whose output for this asset is NOT consumed yet.
  let txHash = null;
  let txIndex = null;
  for (const candidate of assetTxs) {
    const utxosUrl = `https://cardano-${network}.blockfrost.io/api/v0/txs/${candidate.tx_hash}/utxos`;
    const utxosResponse = await fetchFn(utxosUrl, {
      headers: { project_id: blockfrostApiKey },
    });
    if (!utxosResponse.ok) continue;
    const utxosData = await utxosResponse.json();
    for (let i = 0; i < (utxosData.outputs ?? []).length; i += 1) {
      const out = utxosData.outputs[i];
      const hasAsset = (out.amount ?? []).some((a) => a.unit === assetUnit && BigInt(a.quantity) >= 1n);
      if (hasAsset && !out.consumed_by_tx) {
        txHash = candidate.tx_hash;
        txIndex = out.output_index ?? i;
        break;
      }
    }
    if (txHash) break;
  }
  if (!txHash) {
    throw new Error(`handle ${handleName} has no live (unconsumed) UTxO holding ${assetUnit}`);
  }

  const output = await fetchBlockfrostTxOutput(txHash, txIndex, blockfrostApiKey, network, fetchFn);

  let coins = 0n;
  const assets = new Map();
  for (const { unit, quantity } of output.amount) {
    if (unit === "lovelace") {
      coins = BigInt(quantity);
    } else {
      const policyId = unit.slice(0, 56);
      const assetName = unit.slice(56);
      const assetId = Cardano.AssetId.fromParts(
        Cardano.PolicyId(policyId),
        Cardano.AssetName(assetName)
      );
      assets.set(assetId, BigInt(quantity));
    }
  }

  const txIn = {
    txId: Cardano.TransactionId(txHash),
    index: txIndex,
    address: asPaymentAddress(handleAddress),
  };
  const txOut = {
    address: asPaymentAddress(handleAddress),
    value: { coins, ...(assets.size > 0 ? { assets } : {}) },
    ...(output.inline_datum
      ? { datum: Serialization.PlutusData.fromCbor(output.inline_datum).toCore() }
      : {}),
  };
  return [txIn, txOut];
};

const buildUnsignedTxForFee = ({ selection, requestedOutputs, validityInterval, nativeScript }) => {
  const bodyWithHash = createTransactionInternals({
    inputSelection: selection,
    validityInterval,
    outputs: requestedOutputs,
  });
  return {
    id: transactionHashFromCore({ body: bodyWithHash.body }),
    body: bodyWithHash.body,
    witness: {
      signatures: buildPlaceholderSignatures(2),
      ...(nativeScript ? { scripts: [nativeScript] } : {}),
    },
  };
};

// Build the unsigned settings-update tx: spends the settings UTxO, outputs a
// new UTxO at the same address with the patched datum, attaches the native
// script witness. No vkey witnesses — the multisig signers add those after
// the fact (e.g. via cardano-cli transaction witness + transaction assemble).
//
// The patched datum is provided as raw CBOR bytes so byte-for-byte
// preservation from buildPatchedSettingsDatum.js carries through to the
// on-chain output. Re-encoding via cardano-sdk would produce a definite-
// length list; the live datum often uses indefinite-length and validators
// that compare raw bytes would reject the mutation.
export const buildSettingsUpdateTx = async ({
  network,
  settingsHandleName,
  patchedDatumHex,
  nativeScriptCborHex,
  blockfrostApiKey,
  userAgent,
}) => {
  if (!network) throw new Error("settings-update tx: network is required");
  if (!settingsHandleName) throw new Error("settings-update tx: settingsHandleName is required");
  if (!patchedDatumHex) throw new Error("settings-update tx: patchedDatumHex is required");
  if (!nativeScriptCborHex) throw new Error("settings-update tx: nativeScriptCborHex is required");
  if (!blockfrostApiKey) throw new Error("settings-update tx: blockfrostApiKey is required");
  if (!userAgent) throw new Error("settings-update tx: userAgent is required");

  const buildContext = await getBlockfrostBuildContext(network, blockfrostApiKey);

  const handleUtxo = await resolveSettingsHandleUtxo({
    network,
    handleName: settingsHandleName,
    blockfrostApiKey,
    userAgent,
  });
  const scriptAddress = handleUtxo[1].address;

  const handleHex = Buffer.from(settingsHandleName, "utf8").toString("hex");
  const handleAssetId = Cardano.AssetId.fromParts(
    Cardano.PolicyId(HANDLE_POLICY_ID),
    Cardano.AssetName(`${PREFIX_222}${handleHex}`)
  );
  const handleValue = { coins: 0n, assets: new Map([[handleAssetId, 1n]]) };

  // The patched-datum hex must be passed through unchanged so the on-chain
  // datum CBOR matches the bytes produced by buildPatchedSettingsDatum.js.
  // Serialization.PlutusData.fromCbor(...).toCore() then back-to-cbor at
  // serialization time DOES round-trip raw bytes (cardano-sdk preserves the
  // original CBOR encoding via the InlineDatum representation) — this is
  // what decentralized-minting relies on too.
  const datum = Serialization.PlutusData.fromCbor(stripHex(patchedDatumHex)).toCore();

  const minimumCoinQuantity = computeMinimumCoinQuantity(buildContext.protocolParameters.coinsPerUtxoByte);
  const settingsOutput = {
    address: scriptAddress,
    value: handleValue,
    datum,
  };
  settingsOutput.value = { ...settingsOutput.value, coins: minimumCoinQuantity(settingsOutput) };

  const requestedOutputs = [settingsOutput];
  const nativeScript = parseNativeScript(nativeScriptCborHex);

  const allScriptUtxos = await fetchBlockfrostUtxos(
    scriptAddress,
    blockfrostApiKey,
    network,
    fetch,
    { excludeWithReferenceScripts: true }
  );

  // Pre-select the settings handle UTxO; remaining clean UTxOs cover fees.
  // Skip UTxOs holding any tokens — other settings handles at this address
  // (bg_policy_ids, pfp_policy_ids, etc.) must not be consumed as fee inputs.
  const handleUtxoRef = toUtxoRef(handleUtxo);
  const selectedUtxos = [handleUtxo];
  const remainingUtxos = allScriptUtxos.filter((utxo) => {
    if (toUtxoRef(utxo) === handleUtxoRef) return false;
    return (utxo[1].value.assets?.size ?? 0) === 0;
  });
  if (remainingUtxos.length === 0) {
    throw new Error(
      `no clean (no-token) UTxOs at script address ${scriptAddress} to fund settings update; the multisig wallet needs at least one ada-only UTxO`
    );
  }

  const changeAddressBech32 = asPaymentAddress(scriptAddress);

  const inputSelector = roundRobinRandomImprove({
    changeAddressResolver: {
      resolve: async (selection) =>
        selection.change.map((change) => ({ ...change, address: changeAddressBech32 })),
    },
  });

  const txEvaluator = new GreedyTxEvaluator(async () => buildContext.protocolParameters);

  const buildForSelection = (selection) =>
    Promise.resolve(
      buildUnsignedTxForFee({
        selection,
        requestedOutputs,
        validityInterval: buildContext.validityInterval,
        nativeScript,
      })
    );

  const baseConstraints = defaultSelectionConstraints({
    protocolParameters: buildContext.protocolParameters,
    buildTx: buildForSelection,
    redeemersByType: {},
    txEvaluator,
  });
  const constraints = {
    ...baseConstraints,
    computeMinimumCost: async (selection) => {
      const result = await baseConstraints.computeMinimumCost(selection);
      return { ...result, fee: result.fee + NATIVE_SCRIPT_FEE_SAFETY_MARGIN_LOVELACE };
    },
  };

  const selection = await inputSelector.select({
    preSelectedUtxo: new Set(selectedUtxos),
    utxo: new Set(remainingUtxos),
    outputs: new Set(requestedOutputs),
    constraints,
  });

  // Use the selection's fee directly; createTransactionInternals recomputes
  // it from the bare body (no witness overhead) and underestimates.
  const finalTxBodyWithHash = createTransactionInternals({
    inputSelection: selection.selection,
    validityInterval: buildContext.validityInterval,
    outputs: requestedOutputs,
  });

  const unsignedTx = {
    id: finalTxBodyWithHash.hash,
    body: { ...finalTxBodyWithHash.body, fee: selection.selection.fee },
    witness: {
      signatures: new Map(),
      scripts: [nativeScript],
    },
  };

  const estimationTx = {
    ...unsignedTx,
    witness: { ...unsignedTx.witness, signatures: buildPlaceholderSignatures(1) },
  };
  const estimatedSignedTxSize = Serialization.Transaction.fromCore(estimationTx).toCbor().length / 2;

  const cborHex = transactionToCbor(unsignedTx);
  const cborBytes = Buffer.from(cborHex, "hex");

  const consumedInputs = new Set();
  for (const utxo of selection.selection.inputs) {
    consumedInputs.add(toUtxoRef(utxo));
  }

  return {
    cborHex,
    cborBytes,
    estimatedSignedTxSize,
    maxTxSize: buildContext.protocolParameters.maxTxSize,
    consumedInputs,
    txId: String(unsignedTx.id),
    settingsHandleName,
    handleUtxoRef,
    scriptAddress: String(scriptAddress),
  };
};

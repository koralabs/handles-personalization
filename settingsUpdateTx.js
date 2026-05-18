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
  const apiBase = handlesApiBaseUrlForNetwork(network);
  const handleResponse = await fetchFn(
    `${apiBase}/handles/${encodeURIComponent(handleName)}`,
    { headers: { "User-Agent": userAgent } }
  );
  if (!handleResponse.ok) {
    throw new Error(`failed to look up handle ${handleName}: HTTP ${handleResponse.status}`);
  }
  const handleData = await handleResponse.json();
  const utxoRef = handleData?.utxo;
  if (!utxoRef) {
    throw new Error(`handle ${handleName} has no UTxO`);
  }
  const handleAddress = handleData.resolved_addresses?.ada;
  if (!handleAddress) {
    throw new Error(`handle ${handleName} has no resolved ADA address`);
  }

  const [txHash, txIndexStr] = utxoRef.split("#");
  const txIndex = Number.parseInt(txIndexStr, 10);
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
  // Chained-tx support: when building a sequence of multisig settings updates
  // off the same wallet, the first tx consumes the only ada-only UTxO and the
  // subsequent ones must spend the projected change of the previous (which
  // doesn't exist on chain yet). Pass the [txIn, txOut] pair here to add it
  // to the pre-selected input set; the script-address ada-only check is
  // skipped when this is provided.
  additionalPreSelectedUtxos = [],
  // Optional list of UTxO refs ("<txId>#<index>") to EXCLUDE from the
  // selector's remainingUtxos pool. Used when building a batch of
  // independent (non-chained) multisig txs from the same wallet: each
  // tx pre-selects a different on-chain ada-only UTxO, and we want to
  // guarantee the selector doesn't grab one of the other txs' UTxOs as
  // fee padding. Different from additionalPreSelectedUtxos, which
  // includes the listed UTxOs in this tx's inputs.
  excludeFromRemainingUtxos = [],
  // Optional Plutus ref-script to attach to the re-output UTxO. Used by the
  // ord-1 SubHandle attach flow: spends the SubHandle (e.g. persprx1) at the
  // multisig and re-outputs at the same multisig with the V3 contract's
  // compiled cbor as a reference script. The new output's min-ada climbs to
  // cover the script bytes; cardano-sdk's GreedyTxEvaluator picks up the
  // output-side ref-script bytes via requestedOutputs so per-byte fee is
  // already in the selection's computed fee.
  scriptReference = undefined,
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
    ...(scriptReference ? { scriptReference } : {}),
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
  const additionalRefs = new Set(additionalPreSelectedUtxos.map(toUtxoRef));
  const excludedRefs = new Set(excludeFromRemainingUtxos);
  const selectedUtxos = [handleUtxo, ...additionalPreSelectedUtxos];
  const remainingUtxos = allScriptUtxos.filter((utxo) => {
    const ref = toUtxoRef(utxo);
    if (ref === handleUtxoRef) return false;
    if (additionalRefs.has(ref)) return false;
    if (excludedRefs.has(ref)) return false;
    return (utxo[1].value.assets?.size ?? 0) === 0;
  });
  if (remainingUtxos.length === 0 && additionalPreSelectedUtxos.length === 0) {
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

  // Find the ada-only change output for chained-tx callers; the body's
  // outputs are settings-handle-output + 0..N change outputs. The change
  // output(s) live at the script address with no assets.
  const txIdStr = String(unsignedTx.id);
  let changeUtxo = null;
  for (let i = 0; i < unsignedTx.body.outputs.length; i += 1) {
    const out = unsignedTx.body.outputs[i];
    if ((out.value.assets?.size ?? 0) > 0) continue;
    const txIn = {
      txId: Cardano.TransactionId(txIdStr),
      index: i,
      address: out.address,
    };
    changeUtxo = [txIn, out];
    break;
  }

  return {
    cborHex,
    cborBytes,
    estimatedSignedTxSize,
    maxTxSize: buildContext.protocolParameters.maxTxSize,
    consumedInputs,
    txId: txIdStr,
    settingsHandleName,
    handleUtxoRef,
    scriptAddress: String(scriptAddress),
    changeUtxo,
  };
};

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { Buffer } from "node:buffer";

import { roundRobinRandomImprove } from "@cardano-sdk/input-selection";
import {
  computeMinimumCoinQuantity,
  createTransactionInternals,
  defaultSelectionConstraints,
  GreedyTxEvaluator,
} from "@cardano-sdk/tx-construction";

import { getAikenArtifactPaths } from "./compileHelpers.js";
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

export const compilePersonalizationArtifacts = () => {
  execFileSync("node", ["./compileAiken.js"], { stdio: "inherit" });
};

// Loads the per-validator optimized UPLC CBOR (hex) written by
// compileAiken.js. Aiken project compiles to PlutusV3 (per aiken.toml).
const loadPersonalizationProgramCbor = ({
  contractSlug,
  compileFn = compilePersonalizationArtifacts,
  artifactPaths = getAikenArtifactPaths(),
}) => {
  if (!contractSlug) {
    throw new Error("loadPersonalizationProgramCbor: contractSlug is required");
  }
  compileFn();
  const compiledCborPath = artifactPaths.perValidator(contractSlug).compiledCbor;
  if (!fs.existsSync(compiledCborPath)) {
    throw new Error(
      `compiled CBOR not found for contract ${contractSlug} at ${compiledCborPath}`
    );
  }
  return fs.readFileSync(compiledCborPath, "utf8").trim();
};

// Provides the minimum protocol-params surface that the planner uses
// (currently just `maxTxSize`). Build context comes from Blockfrost — same
// path as the Phase A.5 settings tx flow.
export const fetchNetworkParameters = async (network, blockfrostApiKey) => {
  if (!blockfrostApiKey) {
    throw new Error(
      "fetchNetworkParameters: blockfrostApiKey is required (set BLOCKFROST_API_KEY)"
    );
  }
  const ctx = await getBlockfrostBuildContext(network, blockfrostApiKey);
  return { maxTxSize: ctx.protocolParameters.maxTxSize };
};

const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);

const parseCborUtxo = (cborHex) =>
  Serialization.TransactionUnspentOutput.fromCbor(stripHex(cborHex)).toCore();

const toUtxoRef = (utxo) => `${utxo[0].txId}#${utxo[0].index}`;

const buildUnsignedTxForFee = ({ selection, requestedOutputs, validityInterval }) => {
  const bodyWithHash = createTransactionInternals({
    inputSelection: selection,
    validityInterval,
    outputs: requestedOutputs,
  });
  return {
    id: transactionHashFromCore({ body: bodyWithHash.body }),
    body: bodyWithHash.body,
    // Deployer is the only required signer (PubKeyHash address). One
    // placeholder vkey witness so the fee accounts for it.
    witness: { signatures: buildPlaceholderSignatures(1) },
  };
};

// Build the unsigned reference-script deployment tx for one contract:
// consumes the deployment SubHandle UTxO (must be in cborUtxos), outputs
// the SubHandle back to the deployer (changeAddress) with the contract's
// reference script attached, and uses remaining UTxOs to cover fee /
// min-coin.
//
// `cborUtxos` is an array of standard Cardano TransactionUnspentOutput
// hex strings (`[input, output]` CBOR — same format Helios used to
// consume), parsed via cardano-sdk's
// Serialization.TransactionUnspentOutput.fromCbor.
export const buildReferenceScriptDeploymentTx = async ({
  network,
  contractSlug,
  handleName,
  changeAddress,
  cborUtxos,
  blockfrostApiKey,
  loadProgramCborFn = loadPersonalizationProgramCbor,
  // When redeploying a contract that has an existing ref-script attached to
  // its SubHandle UTxO, pass the byte count of that consumed ref-script so
  // we can pad the fee for Conway's minFeeRefScriptCoinsPerByte (cardano-sdk
  // 0.46.12 doesn't include input ref-script bytes in its fee estimate).
  // 0 (no input ref script) is the default; supply only when redeploying.
  inputRefScriptBytes = 0,
}) => {
  if (!network) throw new Error("buildReferenceScriptDeploymentTx: network is required");
  if (!contractSlug) throw new Error("buildReferenceScriptDeploymentTx: contractSlug is required");
  if (!handleName) throw new Error("buildReferenceScriptDeploymentTx: handleName is required");
  if (!changeAddress) throw new Error("buildReferenceScriptDeploymentTx: changeAddress is required");
  if (!Array.isArray(cborUtxos) || cborUtxos.length === 0) {
    throw new Error("buildReferenceScriptDeploymentTx: non-empty cborUtxos is required");
  }
  if (!blockfrostApiKey) {
    throw new Error("buildReferenceScriptDeploymentTx: blockfrostApiKey is required");
  }

  const parsedAddress = Cardano.Address.fromString(changeAddress);
  if (!parsedAddress) {
    throw new Error(`invalid changeAddress: ${changeAddress}`);
  }
  const base = parsedAddress.asBase();
  const enterprise = parsedAddress.asEnterprise();
  const paymentCredential =
    base?.getPaymentCredential() ?? enterprise?.getPaymentCredential();
  if (!paymentCredential || paymentCredential.type !== Cardano.CredentialType.KeyHash) {
    throw new Error("Must be Base or Enterprise key-hash wallet to deploy");
  }

  const buildContext = await getBlockfrostBuildContext(network, blockfrostApiKey);
  const utxos = cborUtxos.map(parseCborUtxo);

  const handleAssetName = `${PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`;
  const handleAssetId = Cardano.AssetId.fromParts(
    Cardano.PolicyId(HANDLE_POLICY_ID),
    Cardano.AssetName(handleAssetName)
  );
  const handleUtxoIndex = utxos.findIndex((utxo) =>
    Boolean(utxo[1].value.assets?.has(handleAssetId))
  );
  if (handleUtxoIndex < 0) {
    throw new Error(`You don't have $${handleName} handle`);
  }
  const handleUtxo = utxos[handleUtxoIndex];
  const remainingUtxos = utxos.filter((_, i) => i !== handleUtxoIndex);

  const compiledCbor = loadProgramCborFn({ contractSlug });
  // PlutusV3 ref-scripts are double-CBOR-encoded on chain: the script-ref bytes
  // inside `[3, X]` must themselves CBOR-decode as a `bytes` value whose
  // contents are the flat-encoded UPLC. Aiken's `compiledCode` is already that
  // outer `bytes(flat_uplc)` form, so we pass it through verbatim. cardano-sdk
  // 0.46.12's `PlutusV3Script.fromCbor(...).toCore()` strips the outer wrapper
  // and emits `[3, raw_flat]`, which Conway then rejects as
  // MalformedReferenceScripts (decodeBytes fails on flat UPLC). Construct the
  // Core script directly with the outer-form bytes.
  const scriptReference = {
    __type: "plutus",
    bytes: stripHex(compiledCbor),
    version: 2, // cardano-sdk PlutusLanguageVersion: 0=V1, 1=V2, 2=V3
  };

  const handleValue = { coins: 0n, assets: new Map([[handleAssetId, 1n]]) };
  const handleOutput = {
    address: asPaymentAddress(changeAddress),
    value: handleValue,
    scriptReference,
  };
  const minimumCoinQuantity = computeMinimumCoinQuantity(
    buildContext.protocolParameters.coinsPerUtxoByte
  );
  handleOutput.value = { ...handleOutput.value, coins: minimumCoinQuantity(handleOutput) };

  const requestedOutputs = [handleOutput];

  const changeAddressBech32 = asPaymentAddress(changeAddress);
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
      })
    );

  const constraints = defaultSelectionConstraints({
    protocolParameters: buildContext.protocolParameters,
    buildTx: buildForSelection,
    redeemersByType: {},
    txEvaluator,
  });

  const selection = await inputSelector.select({
    preSelectedUtxo: new Set([handleUtxo]),
    utxo: new Set(remainingUtxos),
    outputs: new Set(requestedOutputs),
    constraints,
  });

  const finalTxBodyWithHash = createTransactionInternals({
    inputSelection: selection.selection,
    validityInterval: buildContext.validityInterval,
    outputs: requestedOutputs,
  });

  // Conway charges minFeeRefScriptCoinsPerByte for every byte of reference
  // script consumed by an input OR included in an output. cardano-sdk's
  // GreedyTxEvaluator covers the OUTPUT side via the requestedOutputs ref
  // script, but on a REDEPLOY (where the consumed SubHandle UTxO already
  // carries a stale ref-script that we're replacing) it doesn't account
  // for the input ref-script's bytes — so the tx fee comes back ~17 lovelace
  // per byte short of what the ledger requires. Pad the fee for any input
  // we're consuming that already has a ref-script attached. Param value at
  // time of writing is 11 lovelace/byte (we use 17 to leave headroom against
  // future PP changes); excess is pulled out of the largest ada-only change
  // output back to the deployer so the body still balances.
  const REF_SCRIPT_COINS_PER_BYTE = 17n;
  const padding = BigInt(inputRefScriptBytes) * REF_SCRIPT_COINS_PER_BYTE;
  const adjustedFee = BigInt(selection.selection.fee) + padding;

  let adjustedBody = finalTxBodyWithHash.body;
  if (padding > 0n) {
    const outs = [...finalTxBodyWithHash.body.outputs];
    let bestIdx = -1;
    let bestCoin = 0n;
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i];
      const hasAssets = !!o.value?.assets && o.value.assets.size > 0;
      if (hasAssets) continue;
      const c = BigInt(o.value?.coins ?? 0n);
      if (c > bestCoin) { bestCoin = c; bestIdx = i; }
    }
    if (bestIdx < 0 || bestCoin <= padding) {
      throw new Error(`deploymentTx: no clean change output big enough to absorb +${padding} lovelace ref-script fee`);
    }
    const target = outs[bestIdx];
    outs[bestIdx] = {
      ...target,
      value: { ...target.value, coins: BigInt(target.value.coins) - padding },
    };
    adjustedBody = { ...finalTxBodyWithHash.body, outputs: outs, fee: adjustedFee };
  } else {
    adjustedBody = { ...finalTxBodyWithHash.body, fee: adjustedFee };
  }
  const adjustedHash = transactionHashFromCore({ body: adjustedBody });

  const unsignedTx = {
    id: adjustedHash,
    body: adjustedBody,
    witness: { signatures: new Map() },
  };

  const estimationTx = {
    ...unsignedTx,
    witness: { signatures: buildPlaceholderSignatures(1) },
  };
  const estimatedSignedTxSize =
    Serialization.Transaction.fromCore(estimationTx).toCbor().length / 2;

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
    contractSlug,
    handleUtxoRef: toUtxoRef(handleUtxo),
  };
};

import { Buffer } from "node:buffer";

import { roundRobinRandomImprove } from "@cardano-sdk/input-selection";
import {
  computeMinimumCoinQuantity,
  createTransactionInternals,
  defaultSelectionConstraints,
  GreedyTxEvaluator,
} from "@cardano-sdk/tx-construction";

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
    witness: { signatures: buildPlaceholderSignatures(1) },
  };
};

// Build the unsigned datum-attach tx for Phase E cutover. The minting engine
// has already minted the new handle to the deployer wallet; this tx spends
// that handle UTxO and re-locates it to the multisig native-script address
// with the inline settings datum attached. Once submitted, the handle's
// holder becomes the multisig (the same place the live pz_settings lives
// today) and the datum is canonical for downstream readers.
//
// Witness shape: only the deployer wallet's vkey is required — the input is
// at a wallet address, and outputs *to* a script address don't need the
// script to be witnessed. Subsequent edits to the datum (after cutover) go
// through `settingsUpdateTx.js` which re-spends from the multisig address
// and DOES require the native-script witness + multisig signatures.
//
// `cborUtxos` is an array of standard Cardano TransactionUnspentOutput hex
// strings — same format the deploymentTx CLI consumes.
export const buildSettingsAttachTx = async ({
  network,
  handleName,
  inlineDatumHex,
  multisigAddress,
  deployerAddress,
  cborUtxos,
  blockfrostApiKey,
}) => {
  if (!network) throw new Error("settings-attach tx: network is required");
  if (!handleName) throw new Error("settings-attach tx: handleName is required");
  if (!inlineDatumHex) throw new Error("settings-attach tx: inlineDatumHex is required");
  if (!multisigAddress) throw new Error("settings-attach tx: multisigAddress is required");
  if (!deployerAddress) throw new Error("settings-attach tx: deployerAddress is required");
  if (!Array.isArray(cborUtxos) || cborUtxos.length === 0) {
    throw new Error("settings-attach tx: non-empty cborUtxos is required");
  }
  if (!blockfrostApiKey) throw new Error("settings-attach tx: blockfrostApiKey is required");

  const parsedDeployer = Cardano.Address.fromString(deployerAddress);
  if (!parsedDeployer) throw new Error(`invalid deployerAddress: ${deployerAddress}`);
  const base = parsedDeployer.asBase();
  const enterprise = parsedDeployer.asEnterprise();
  const paymentCredential =
    base?.getPaymentCredential() ?? enterprise?.getPaymentCredential();
  if (!paymentCredential || paymentCredential.type !== Cardano.CredentialType.KeyHash) {
    throw new Error("deployerAddress must be a key-hash (Base or Enterprise) wallet address");
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
    throw new Error(
      `deployer wallet does not hold $${handleName} — mint the handle first, then re-run`
    );
  }
  const handleUtxo = utxos[handleUtxoIndex];
  const remainingUtxos = utxos.filter((_, i) => i !== handleUtxoIndex);

  // Inline datum is round-tripped through cardano-sdk's PlutusData. cardano-sdk
  // may re-encode definite → indefinite list form; the validator reads the
  // datum structurally (PzSettings::from_data) so the encoding shift is
  // benign (see settingsUpdateTx.js for the same trade-off).
  const datum = Serialization.PlutusData.fromCbor(stripHex(inlineDatumHex)).toCore();

  const handleValue = { coins: 0n, assets: new Map([[handleAssetId, 1n]]) };
  const settingsOutput = {
    address: asPaymentAddress(multisigAddress),
    value: handleValue,
    datum,
  };
  const minimumCoinQuantity = computeMinimumCoinQuantity(
    buildContext.protocolParameters.coinsPerUtxoByte
  );
  settingsOutput.value = {
    ...settingsOutput.value,
    coins: minimumCoinQuantity(settingsOutput),
  };

  const requestedOutputs = [settingsOutput];

  const changeAddressBech32 = asPaymentAddress(deployerAddress);
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

  const unsignedTx = {
    id: finalTxBodyWithHash.hash,
    body: { ...finalTxBodyWithHash.body, fee: selection.selection.fee },
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
    handleName,
    handleUtxoRef: toUtxoRef(handleUtxo),
    multisigAddress,
  };
};

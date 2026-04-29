import { Buffer } from "node:buffer";

import { roundRobinRandomImprove } from "@cardano-sdk/input-selection";
import {
  computeMinimumCoinQuantity,
  createTransactionInternals,
  defaultSelectionConstraints,
  GreedyTxEvaluator,
} from "@cardano-sdk/tx-construction";

import { getBlockfrostBuildContext } from "./blockfrostContext.js";
import { fetchBlockfrostUtxos } from "./blockfrostUtxo.js";
import {
  asPaymentAddress,
  buildPlaceholderSignatures,
  Cardano,
  Serialization,
  transactionHashFromCore,
  transactionToCbor,
} from "./index.js";
import { signTxWithWallet } from "./signTx.js";
import { submitTx } from "./submitTx.js";

// Submits a self-payment "anchor" tx at the deployer wallet (derivation 12
// when used by the Phase E orchestrator). The whole tx is one input + one
// output back to the same wallet at min coin, producing a real on-chain
// txHash that satisfies the minting engine's requirement that every PAID
// session row carry a `txHash` (commit f22ef67f, "fixing free mints").
//
// Cost: ~0.17 ADA in fees per tx (no value lost — same wallet on both
// sides). Used once per Phase E handle reservation so each session row
// gets a unique, real, auditable on-chain anchor.
//
// Args:
//   network              "preview" | "preprod" | "mainnet"
//   wallet               result of getPolicyWallet({ derivation: 12, ... })
//   blockfrostApiKey     for protocol params + UTxO fetch + submit
//
// Returns: { txHash, cborHex, estimatedSignedTxSize, fee }
export const submitAnchorSelfTx = async ({ network, wallet, blockfrostApiKey }) => {
  if (!network) throw new Error("submitAnchorSelfTx: network is required");
  if (!wallet?.address) throw new Error("submitAnchorSelfTx: wallet (with .address) is required");
  if (!blockfrostApiKey) throw new Error("submitAnchorSelfTx: blockfrostApiKey is required");

  const buildContext = await getBlockfrostBuildContext(network, blockfrostApiKey);
  const utxos = await fetchBlockfrostUtxos(wallet.address, blockfrostApiKey, network);
  if (utxos.length === 0) {
    throw new Error(
      `submitAnchorSelfTx: ${wallet.address} has no UTxOs on ${network}; the deployer wallet needs at least one ada-only UTxO to anchor`
    );
  }

  // Pick the smallest UTxO with no native assets to keep the anchor tx tiny.
  const cleanUtxos = utxos
    .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
    .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n)));
  if (cleanUtxos.length === 0) {
    throw new Error(
      `submitAnchorSelfTx: ${wallet.address} has no clean (no-token) UTxOs on ${network}; need at least one ada-only UTxO`
    );
  }

  const changeAddressBech32 = asPaymentAddress(wallet.address);
  const minimumCoinQuantity = computeMinimumCoinQuantity(buildContext.protocolParameters.coinsPerUtxoByte);
  const requestedOutput = {
    address: changeAddressBech32,
    value: { coins: 0n },
  };
  requestedOutput.value = { ...requestedOutput.value, coins: minimumCoinQuantity(requestedOutput) };
  const requestedOutputs = [requestedOutput];

  const inputSelector = roundRobinRandomImprove({
    changeAddressResolver: {
      resolve: async (selection) =>
        selection.change.map((change) => ({ ...change, address: changeAddressBech32 })),
    },
  });
  const txEvaluator = new GreedyTxEvaluator(async () => buildContext.protocolParameters);

  const buildForSelection = (selection) => {
    const bodyWithHash = createTransactionInternals({
      inputSelection: selection,
      validityInterval: buildContext.validityInterval,
      outputs: requestedOutputs,
    });
    return Promise.resolve({
      id: transactionHashFromCore({ body: bodyWithHash.body }),
      body: bodyWithHash.body,
      witness: { signatures: buildPlaceholderSignatures(1) },
    });
  };

  const constraints = defaultSelectionConstraints({
    protocolParameters: buildContext.protocolParameters,
    buildTx: buildForSelection,
    redeemersByType: {},
    txEvaluator,
  });

  const selection = await inputSelector.select({
    preSelectedUtxo: new Set(),
    utxo: new Set(cleanUtxos),
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
  const unsignedCborHex = transactionToCbor(unsignedTx);

  // estimate size with placeholder sig
  const estimationTx = {
    ...unsignedTx,
    witness: { signatures: buildPlaceholderSignatures(1) },
  };
  const estimatedSignedTxSize =
    Serialization.Transaction.fromCore(estimationTx).toCbor().length / 2;

  const signedHex = signTxWithWallet(unsignedCborHex, wallet);
  const txHash = await submitTx({ network, signedTxCborHex: signedHex, blockfrostApiKey });

  return {
    txHash,
    cborHex: signedHex,
    estimatedSignedTxSize,
    fee: String(selection.selection.fee),
  };
};

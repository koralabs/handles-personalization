#!/usr/bin/env node
//
// One-shot top-up: send 100 tADA from the e2e live wallet (mnemonic-based,
// in handle.me/static/.env.local) to the deployer wallet at derivation 12
// (POLICY_KEY-derived, holder of @handlecontract).
//
// The deployer wallet starts at ~50 tADA on preview after typical anchor
// activity, but the V3 ref-script deploy for pers_logic (~20.6 KB) needs
// a min-coin output of ~95 tADA. This script funds the gap.
//
// Usage:
//   node scripts/topupDeployer.js --network preview [--lovelace <amt>]
//
// Reads E2E_LIVE_WALLET_MNEMONIC from handle.me/static/.env.local and
// BLOCKFROST_API_KEY from minting.handle.me/.env (or env). Submits via
// the same submitTx helper used elsewhere.

import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

import { roundRobinRandomImprove } from "@cardano-sdk/input-selection";
import {
  computeMinimumCoinQuantity,
  createTransactionInternals,
  defaultSelectionConstraints,
  GreedyTxEvaluator,
} from "@cardano-sdk/tx-construction";
import { Bip32PrivateKey } from "@cardano-sdk/crypto";
import * as bip39 from "bip39";
import sodium from "libsodium-wrappers-sumo";

import {
  asPaymentAddress,
  buildPlaceholderSignatures,
  Cardano,
  Serialization,
  transactionHashFromCore,
  transactionToCbor,
} from "../helpers/cardano-sdk/index.js";
import { getBlockfrostBuildContext } from "../helpers/cardano-sdk/blockfrostContext.js";
import { fetchBlockfrostUtxos } from "../helpers/cardano-sdk/blockfrostUtxo.js";
import { submitTx } from "../helpers/cardano-sdk/submitTx.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";

const HARDENED = 0x80000000;
const DEFAULT_LOVELACE = 100_000_000n; // 100 tADA

const loadEnvFromFile = (path) => {
  try {
    const raw = readFileSync(path, "utf8");
    const env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${t}`);
    }
    args[t.slice(2)] = next;
    i += 1;
  }
  return args;
};

const deriveE2eWallet = async (mnemonic, networkId) => {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = await Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy, "hex"), "");
  const account = root.derive([1852 + HARDENED, 1815 + HARDENED, 0 + HARDENED]);
  const paymentKey = (await account.derive([0, 0])).toRawKey();
  const stakeKey = (await account.derive([2, 0])).toRawKey();
  const paymentPub = await paymentKey.toPublic();
  const stakePub = await stakeKey.toPublic();
  const paymentKeyHashHex = (await paymentPub.hash()).hex();
  const stakeKeyHashHex = (await stakePub.hash()).hex();
  const address = Cardano.BaseAddress.fromCredentials(
    networkId,
    { type: Cardano.CredentialType.KeyHash, hash: paymentKeyHashHex },
    { type: Cardano.CredentialType.KeyHash, hash: stakeKeyHashHex }
  )
    .toAddress()
    .toBech32();
  return { paymentKey, paymentKeyHashHex, address };
};

const main = async () => {
  await sodium.ready;
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!["preview", "preprod"].includes(network)) {
    throw new Error("usage: --network <preview|preprod>");
  }
  const lovelace = BigInt(args.lovelace || DEFAULT_LOVELACE.toString());

  const minting = loadEnvFromFile("/home/jesse/src/koralabs/minting.handle.me/.env");
  const handlemeStatic = loadEnvFromFile("/home/jesse/src/koralabs/handle.me/static/.env.local");
  const blockfrostApiKey =
    minting.BLOCKFROST_API_KEY || process.env.BLOCKFROST_API_KEY;
  const policyKeyBech32 = minting.POLICY_KEY || process.env.POLICY_KEY;
  const mnemonic = handlemeStatic.E2E_LIVE_WALLET_MNEMONIC || process.env.E2E_LIVE_WALLET_MNEMONIC;
  if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY is required");
  if (!policyKeyBech32) throw new Error("POLICY_KEY is required (to derive the deployer address)");
  if (!mnemonic) throw new Error("E2E_LIVE_WALLET_MNEMONIC is required");

  const networkId = network === "preview" || network === "preprod" ? 0 : 1;

  const deployer = getPolicyWallet({ policyKeyBech32, derivation: 12, network });
  const e2e = await deriveE2eWallet(mnemonic, networkId);
  console.log(`From (e2e): ${e2e.address}`);
  console.log(`To (d12):   ${deployer.address}`);
  console.log(`Amount:     ${lovelace} lovelace (${Number(lovelace) / 1_000_000} tADA)`);

  const buildContext = await getBlockfrostBuildContext(network, blockfrostApiKey);
  const utxos = await fetchBlockfrostUtxos(e2e.address, blockfrostApiKey, network);
  const cleanUtxos = utxos
    .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
    .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n)));
  if (cleanUtxos.length === 0) {
    throw new Error("e2e wallet has no clean UTxOs");
  }

  const requestedOutput = {
    address: asPaymentAddress(deployer.address),
    value: { coins: lovelace },
  };
  const requestedOutputs = [requestedOutput];

  const inputSelector = roundRobinRandomImprove({
    changeAddressResolver: {
      resolve: async (selection) =>
        selection.change.map((change) => ({ ...change, address: asPaymentAddress(e2e.address) })),
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

  const finalBody = createTransactionInternals({
    inputSelection: selection.selection,
    validityInterval: buildContext.validityInterval,
    outputs: requestedOutputs,
  });
  const unsignedTx = {
    id: finalBody.hash,
    body: { ...finalBody.body, fee: selection.selection.fee },
    witness: { signatures: new Map() },
  };
  const unsignedCborHex = transactionToCbor(unsignedTx);

  // Sign with e2e payment key
  const txHashHex = String(unsignedTx.id);
  const sig = await e2e.paymentKey.sign(txHashHex);
  const pub = await e2e.paymentKey.toPublic();

  const signedTx = {
    ...unsignedTx,
    witness: {
      signatures: new Map([[pub.hex(), sig.hex()]]),
    },
  };
  const signedCborHex = transactionToCbor(signedTx);
  console.log(`Signed tx: ${unsignedTx.id}`);
  console.log(`Submitting...`);
  const txHash = await submitTx({ network, signedTxCborHex: signedCborHex, blockfrostApiKey });
  console.log(`✓ submitted: ${txHash}`);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

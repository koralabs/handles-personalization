#!/usr/bin/env node
// Push the partners-trie bg_root from DynamoDB onto the on-chain
// `pers_bg@handle_settings` UTxO at the multisig address.
//
// Spends the existing pers_bg@handle_settings UTxO (held at the
// preview multisig 1-of-2 RequireAnyOf), outputs a new UTxO at the
// same address with the same asset and a fresh inline datum encoding
// the new bg_root as a 32-byte CBOR ByteArray. Signs with the
// deployer wallet at derivation 12 (which is one of the 2 multisig
// signers).
//
// Reads:
//   - POLICY_KEY (env or --policy-key)         — bech32 xprv root
//   - BLOCKFROST_API_KEY (env or --blockfrost-api-key)
//   - --network preview (only network supported today)

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import cbor from "cbor";
import sodium from "libsodium-wrappers-sumo";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";
import { signTxWithWallet } from "../helpers/cardano-sdk/signTx.js";
import { submitTx } from "../helpers/cardano-sdk/submitTx.js";
import { fetchPartnersTrieRoots } from "../helpers/dynamoPartnersRoots.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";

const SETTINGS_HANDLE = "pers_bg@handle_settings";

// Per-network multisig native script CBORs. Source of truth:
//   preview : adahandle-deployments preview config (RequireAnyOf 1-of-2)
//   preprod : adahandle-deployments preprod config (RequireAnyOf 1-of-2)
//   mainnet : adahandle-deployments/tasks/tmp/mainnet-contract-migration/
//             mainnet-wallet-payment-native-script.json (RequireMOf 2-of-4).
//             Script hash d0496ab7c9be3c9947676328dbac37dcb39d0f0586a22f4ee9c49494
//             — verified matches the on-chain script credential of
//             pz_settings@handlecontract and pers1@handlecontract.
const NATIVE_SCRIPT_CBOR_HEX_BY_NETWORK = {
  preview:
    "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b" +
    "8200581cd9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d",
  preprod:
    // RequireAnyOf admins 5b468ea6… / 548afd43… (per project memory)
    "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b" +
    "8200581c548afd43158ec53fcd94290c41d1b4496c0746617f0efbb974440bb4",
  mainnet:
    // RequireMOf 2 of 4 (CBOR tag 03 = AtLeast, required=2, 4 sig scripts)
    "830302848200581c0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d" +
    "8200581cfafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8" +
    "8200581c75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2" +
    "8200581cb5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa",
};
const MULTISIG_SIGNERS_BY_NETWORK = {
  preview: [
    "5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b",
    "d9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d",
  ],
  preprod: [
    "5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b",
    "548afd43158ec53fcd94290c41d1b4496c0746617f0efbb974440bb4",
  ],
  mainnet: [
    "0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d",
    "fafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8",
    "75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2",
    "b5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa",
  ],
};
const MULTISIG_THRESHOLD_BY_NETWORK = {
  preview: 1,
  preprod: 1,
  mainnet: 2,
};

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
      args[t.slice(2)] = "true";
    } else {
      args[t.slice(2)] = next;
      i += 1;
    }
  }
  return args;
};

const encodeRootHexAsByteArrayDatum = (rootHex) => {
  const buf = Buffer.from(rootHex, "hex");
  if (buf.length !== 32) throw new Error(`expected 32-byte root, got ${buf.length}`);
  return cbor.encode(buf).toString("hex");
};

const main = async () => {
  await sodium.ready;
  const args = parseArgs(process.argv.slice(2));

  // Require --network (no silent default). Same posture as
  // valkey-utility post-incident: silent network defaults on multi-net
  // scripts mutate the wrong chain.
  const NETWORK = (args["network"] || "").trim().toLowerCase();
  if (!["preview", "preprod", "mainnet"].includes(NETWORK)) {
    throw new Error("required: --network preview|preprod|mainnet (no default)");
  }
  const NATIVE_SCRIPT_CBOR_HEX = NATIVE_SCRIPT_CBOR_HEX_BY_NETWORK[NETWORK];
  const expectedSigners = MULTISIG_SIGNERS_BY_NETWORK[NETWORK];
  const multisigThreshold = MULTISIG_THRESHOLD_BY_NETWORK[NETWORK];

  // Read blockfrost key from the network's BFF env, not the global
  // minting.handle.me/.env (which may be pointed at any network).
  const bffEnv = loadEnvFromFile(`/home/jesse/src/koralabs/handle.me/bff/.env.${NETWORK}.local`);
  const policyKeyBech32 = (args["policy-key"] || bffEnv.POLICY_KEY || process.env.POLICY_KEY || "").trim();
  const blockfrostApiKey = (args["blockfrost-api-key"] || bffEnv.BLOCKFROST_API_KEY || process.env.BLOCKFROST_API_KEY || "").trim();
  if (!policyKeyBech32) throw new Error(`POLICY_KEY is required (from --policy-key or bff/.env.${NETWORK}.local)`);
  if (!blockfrostApiKey) throw new Error(`BLOCKFROST_API_KEY is required (from --blockfrost-api-key or bff/.env.${NETWORK}.local)`);
  const userAgent = "kora-cutover/1.0";

  console.log(`Fetching latest bg_root from partners_${NETWORK}...`);
  const roots = await fetchPartnersTrieRoots({ network: NETWORK });
  console.log(`  bg_root: ${roots.bg_root}`);
  console.log(`  source:  ${roots.source}`);

  const wallet = getPolicyWallet({ policyKeyBech32, derivation: 12, network: NETWORK });
  console.log(`deployer wallet (d12): ${wallet.address}`);
  console.log(`deployer payment key hash: ${wallet.publicKeyHash}`);

  const deployerCanSign = expectedSigners.includes(wallet.publicKeyHash);
  if (!deployerCanSign) {
    console.warn(
      `! deployer key hash ${wallet.publicKeyHash} is NOT in the multisig signer set ` +
        `(${expectedSigners.join(", ")}). Will produce an unsigned tx artifact for ` +
        `multisig co-signing instead of submitting.`
    );
  } else if (multisigThreshold > 1) {
    console.log(`✓ deployer is one of the multisig signers, but ${multisigThreshold}-of-${expectedSigners.length} threshold means the deployer alone is insufficient. Will produce unsigned tx artifact for co-signing.`);
  } else {
    console.log(`✓ deployer is a valid signer for the multisig`);
  }

  const patchedDatumHex = encodeRootHexAsByteArrayDatum(roots.bg_root);
  console.log(`patched bg_root datum (CBOR): ${patchedDatumHex}`);

  console.log(`Building settings-update tx for ${SETTINGS_HANDLE}...`);
  const built = await buildSettingsUpdateTx({
    network: NETWORK,
    settingsHandleName: SETTINGS_HANDLE,
    patchedDatumHex,
    nativeScriptCborHex: NATIVE_SCRIPT_CBOR_HEX,
    blockfrostApiKey,
    userAgent,
  });

  console.log(`  unsigned txId:        ${built.txId}`);
  console.log(`  estimated signed size: ${built.estimatedSignedTxSize}/${built.maxTxSize}`);

  const needsMultisig = !deployerCanSign || multisigThreshold > 1;
  if (needsMultisig) {
    const out = `/tmp/syncBgRoot-${NETWORK}-unsigned.tx.cbor.hex`;
    const fs = await import("node:fs");
    fs.writeFileSync(out, built.cborHex);
    console.log(`Unsigned tx CBOR saved to ${out}`);
    if (multisigThreshold > 1) {
      console.log(`Hand off to ${multisigThreshold} of these ${expectedSigners.length} multisig signers to add witnesses + submit:`);
    } else {
      console.log(`Hand off to a multisig signer (one of these) to add witnesses + submit:`);
    }
    expectedSigners.forEach((s) => console.log(`  - ${s}`));
    return;
  }

  console.log(`Signing with deployer wallet (d12)...`);
  const signedHex = signTxWithWallet(built.cborHex, wallet);
  console.log(`  signed length: ${signedHex.length / 2} bytes`);

  console.log(`Submitting...`);
  const txHash = await submitTx({ network: NETWORK, signedTxCborHex: signedHex, blockfrostApiKey });
  console.log(`✓ submitted: ${txHash}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

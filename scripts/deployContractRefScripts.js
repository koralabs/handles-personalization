#!/usr/bin/env node
//
// Deploy the V3 contract ref-scripts (pers_logic + pers_proxy) on chain.
// Runs after scripts/reserveContractHandles.js has minted the deployment
// SubHandles (pers_logic1@handlecontract, pers_proxy1@handlecontract) to
// derivation 12. This script:
//
//   1. Verifies both deployment SubHandles exist on chain.
//   2. Compiles + loads the per-validator CBOR from plutus.json (via
//      deploymentTx.loadPersonalizationProgramCbor).
//   3. Builds, signs, and submits one ref-script deployment tx per contract:
//        - consumes the deployment SubHandle UTxO at derivation 12
//        - re-outputs it back to derivation 12 with the ref-script attached
//        - extra UTxOs from the deployer wallet cover fee + min-coin
//   4. Waits for each tx to confirm before submitting the next, so the
//      second tx's UTxO selection sees a settled chain state.
//
// Both deploy txs require POLICY_KEY (derivation 12) signature only —
// no multisig.
//
// Usage:
//   node scripts/deployContractRefScripts.js --network preview \
//        [--policy-key <bech32 xprv>]    (or POLICY_KEY env)
//        [--blockfrost-api-key <key>]    (or BLOCKFROST_API_KEY env)
//        [--dry-run]                     (build + log; do not sign or submit)
//
// On success, prints the refScriptUtxo for each contract — exactly what the
// BFF needs to populate its V3 ref-script lookup, and what
// scripts/addV3HashesToValidContracts.js depends on (the hashes are already
// in valid_contracts once that tx is signed + submitted).

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { buildReferenceScriptDeploymentTx } from "../deploymentTx.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";
import { signTxWithWallet } from "../helpers/cardano-sdk/signTx.js";
import { submitTx } from "../helpers/cardano-sdk/submitTx.js";
import { fetchBlockfrostUtxos } from "../helpers/cardano-sdk/blockfrostUtxo.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";

const ALLOWED_NETWORKS = ["preview", "preprod", "mainnet"];

// Pairs of (contract_slug -> deployment_handle), matching deploy/<network>/personalization.yaml
// + the discoverNextContractSubhandle ordinal-1 convention.
const CONTRACTS = [
  { slug: "pers_logic", handle: "pers_logic1@handlecontract" },
  { slug: "pers_proxy", handle: "pers_proxy1@handlecontract" },
];

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    if (t === "--dry-run") {
      args["dry-run"] = "true";
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${t}`);
    }
    args[t.slice(2)] = next;
    i += 1;
  }
  return args;
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

const verifyHandleOnChain = async (handle, network) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}`;
  const r = await fetch(url, { headers: { "User-Agent": "kora-cutover/1.0" } });
  return r.ok;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForTxConfirmation = async (network, blockfrostApiKey, txId, timeoutMs = 180_000) => {
  const url = `https://cardano-${network}.blockfrost.io/api/v0/txs/${txId}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(url, { headers: { project_id: blockfrostApiKey } });
    if (r.ok) return true;
    await sleep(5000);
  }
  return false;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!ALLOWED_NETWORKS.includes(network)) {
    throw new Error(`usage: --network <${ALLOWED_NETWORKS.join("|")}>`);
  }
  const minting = loadEnvFromFile("/home/jesse/src/koralabs/minting.handle.me/.env");
  const policyKeyBech32 =
    (args["policy-key"] || minting.POLICY_KEY || process.env.POLICY_KEY || "").trim();
  const blockfrostApiKey =
    (args["blockfrost-api-key"] || minting.BLOCKFROST_API_KEY || process.env.BLOCKFROST_API_KEY || "").trim();
  const dryRun = args["dry-run"] === "true";

  if (!policyKeyBech32) throw new Error("POLICY_KEY is required");
  if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY is required");

  // 1. Verify both deployment SubHandles are minted
  console.log("Pre-flight: verifying deployment SubHandles are on chain...");
  for (const c of CONTRACTS) {
    const ok = await verifyHandleOnChain(c.handle, network);
    if (!ok) {
      throw new Error(
        `${c.handle} is NOT on chain yet. Run scripts/reserveContractHandles.js first ` +
          `and wait for the engine cron (typically <2 min).`
      );
    }
    console.log(`  ✓ ${c.handle}`);
  }

  // 2. Get deployer wallet
  const wallet = getPolicyWallet({ policyKeyBech32, derivation: 12, network });
  console.log(`Deployer wallet (d12): ${wallet.address}`);

  if (dryRun) console.log("DRY RUN — will build txs but not sign/submit.");

  // 3. Deploy each contract sequentially
  const deployed = [];
  for (const c of CONTRACTS) {
    console.log(`\n=== Deploying ${c.slug} (${c.handle}) ===`);

    // Fetch deployer UTxOs (after each successful deploy, this picks up the
    // new ref-script UTxO from the previous tx as the next deployer state).
    const utxos = await fetchBlockfrostUtxos(wallet.address, blockfrostApiKey, network, fetch);
    console.log(`  deployer UTxOs: ${utxos.length}`);
    const cborUtxos = utxos.map((u) =>
      // Each utxo from fetchBlockfrostUtxos is [TxIn, TxOut] core; re-encode as
      // a single CBOR TransactionUnspentOutput hex string for buildRef…Tx.
      Serialization.TransactionUnspentOutput.fromCore(u).toCbor()
    );

    const built = await buildReferenceScriptDeploymentTx({
      network,
      contractSlug: c.slug,
      handleName: c.handle,
      changeAddress: wallet.address,
      cborUtxos,
      blockfrostApiKey,
    });
    console.log(`  unsigned txId: ${built.txId}`);
    console.log(`  estimated signed size: ${built.estimatedSignedTxSize}/${built.maxTxSize}`);

    if (dryRun) {
      deployed.push({ ...c, txId: built.txId, refScriptUtxo: `${built.txId}#0`, status: "dry_run" });
      continue;
    }

    console.log(`  signing...`);
    const signedHex = signTxWithWallet(built.cborHex, wallet);
    console.log(`  submitting...`);
    const txHash = await submitTx({ network, signedTxCborHex: signedHex, blockfrostApiKey });
    console.log(`  ✓ submitted: ${txHash}`);

    console.log(`  waiting for confirmation...`);
    const confirmed = await waitForTxConfirmation(network, blockfrostApiKey, txHash);
    if (!confirmed) {
      throw new Error(`tx ${txHash} did not confirm within timeout`);
    }
    console.log(`  ✓ confirmed`);
    deployed.push({ ...c, txId: txHash, refScriptUtxo: `${txHash}#0` });
  }

  console.log("\n=== Deploy summary ===");
  for (const d of deployed) {
    console.log(`  ${d.slug}:`);
    console.log(`    handle:        ${d.handle}`);
    console.log(`    txId:          ${d.txId}`);
    console.log(`    refScriptUtxo: ${d.refScriptUtxo}`);
  }
  console.log(
    "\nNext: ensure scripts/addV3HashesToValidContracts.js's tx is signed + submitted " +
      "(hashes already in valid_contracts), then point the BFF V3 path at these refScriptUtxos."
  );
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

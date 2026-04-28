#!/usr/bin/env node
//
// Phase E cutover orchestrator. Per-network end-to-end:
//
//   1. Reserve mints for the three settings handles (pers@handle_settings,
//      pers_bg@handle_settings, pers_pfp@handle_settings) in the engine's
//      DynamoDB session table. Engine cron mints them to derivation 12.
//
//   2. Poll api.handle.me until each handle returns 200, then wait an
//      additional buffer for Blockfrost indexing.
//
//   3. For each handle, build + sign + submit the datum-attach tx:
//        pers@handle_settings  -> copy of live pz_settings 9-field datum
//        pers_bg@handle_settings -> 32-byte bg trie root (from DynamoDB)
//        pers_pfp@handle_settings -> 32-byte pfp trie root (from DynamoDB)
//
//      Signed by derivation 12's vkey only. Output goes to the existing
//      multisig native-script address (resolved from the live pz_settings
//      handle's holder).
//
//   4. Verify by re-fetching each handle's datum and confirming the bytes.
//
// Usage:
//   node scripts/runPhaseECutover.js \
//        --network <preview|preprod|mainnet> \
//        [--blockfrost-api-key <key>]    (or BLOCKFROST_API_KEY env var)
//        [--policy-key <bech32-xprv>]    (or POLICY_KEY env var; required
//                                          for the attach step)
//        [--dry-run]                     (full plan, no DynamoDB / chain mutation)
//        [--skip-reserve]                (assume reservations already inserted)
//        [--skip-attach]                 (only do reserve + wait)
//
// Read PHASE_BCD_DECISIONS.md "Phase E — live cutover sequence" for the
// canonical context.

import { Buffer } from "node:buffer";
import process from "node:process";

import cbor from "cbor";

import {
  ALLOWED_NETWORKS,
  RETURN_ADDRESS,
  SETTINGS_HANDLES,
  handlesApiBaseUrlForNetwork,
  reserveAllSettingsHandles,
} from "./reserveSettingsHandles.js";
import { buildSettingsAttachTx } from "../settingsAttachTx.js";
import { fetchPartnersTrieRoots } from "../helpers/dynamoPartnersRoots.js";
import { fetchBlockfrostUtxos } from "../helpers/cardano-sdk/blockfrostUtxo.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";
import { signTxWithWallet } from "../helpers/cardano-sdk/signTx.js";
import { submitTx } from "../helpers/cardano-sdk/submitTx.js";

const SETTINGS_HANDLE = "pers@handle_settings";
const BG_HANDLE = "pers_bg@handle_settings";
const PFP_HANDLE = "pers_pfp@handle_settings";

// Polling cadence for the post-reservation wait. Mirrors DeMi's deployment
// workflow: 60-second sleep between attempts, up to 60 attempts.
const POLL_INTERVAL_MS = 60_000;
const POLL_MAX_ATTEMPTS = 60;
const BLOCKFROST_INDEXING_BUFFER_MS = 60_000;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    if (token === "--dry-run" || token === "--skip-reserve" || token === "--skip-attach") {
      args[token.slice(2)] = "true";
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    args[token.slice(2)] = next;
    i += 1;
  }
  return args;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchHandlePayload = async (handle, network, userAgent) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`handle lookup ${handle}: HTTP ${response.status}`);
  }
  return response.json();
};

const fetchHandleDatumHex = async (handle, network, userAgent) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}/datum`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new Error(`datum lookup ${handle}: HTTP ${response.status}`);
  }
  return (await response.text()).trim();
};

const waitForHandleOnChain = async (handle, network, userAgent) => {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
    const payload = await fetchHandlePayload(handle, network, userAgent);
    if (payload && payload.utxo) {
      console.log(`  ${handle}: confirmed on-chain (attempt ${attempt}, utxo=${payload.utxo})`);
      return payload;
    }
    if (attempt === POLL_MAX_ATTEMPTS) {
      throw new Error(`${handle} did not appear on-chain after ${POLL_MAX_ATTEMPTS} attempts`);
    }
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`  ${handle}: attempt ${attempt}/${POLL_MAX_ATTEMPTS}, waiting ${POLL_INTERVAL_MS / 1000}s...`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`unreachable`);
};

const resolveMultisigAddress = async (network, userAgent) => {
  const payload = await fetchHandlePayload("pz_settings", network, userAgent);
  if (!payload) {
    throw new Error(
      `cannot resolve multisig address: pz_settings not found on ${network}. The legacy handle must still exist at cutover time so we know the script address.`
    );
  }
  const addr = payload.resolved_addresses?.ada;
  if (!addr) {
    throw new Error(`pz_settings on ${network} has no resolved ADA address`);
  }
  return addr;
};

// pers@handle_settings datum: copy of the live pz_settings 9-field datum,
// passed through cbor-decode + re-encode so we end up with deterministic
// bytes. We're NOT applying any field patches here — settings drift is a
// separate workflow (settingsUpdateTx).
const sourceSettingsDatumHex = async (network, userAgent) => {
  const liveHex = await fetchHandleDatumHex("pz_settings", network, userAgent);
  return liveHex;
};

// pers_bg / pers_pfp datum: bare 32-byte ByteArray = the per-category trie
// root from DynamoDB. CBOR encoding of a 32-byte byte string is `5820 ||
// <32 bytes>`.
const encodeRootHexAsByteArrayDatum = (rootHex) => {
  const buf = Buffer.from(rootHex, "hex");
  if (buf.length !== 32) {
    throw new Error(`expected 32-byte root, got ${buf.length} bytes`);
  }
  return cbor.encode(buf).toString("hex");
};

const utxoToCborHex = (utxo) =>
  Serialization.TransactionUnspentOutput.fromCore(utxo).toCbor();

const buildAttachContext = async ({
  handle,
  network,
  multisigAddress,
  deployerAddress,
  blockfrostApiKey,
}) => {
  const utxos = await fetchBlockfrostUtxos(deployerAddress, blockfrostApiKey, network);
  const cborUtxos = utxos.map(utxoToCborHex);
  return { handle, network, multisigAddress, deployerAddress, cborUtxos };
};

const isAlreadyAttached = async (handle, network, userAgent, multisigAddress) => {
  const payload = await fetchHandlePayload(handle, network, userAgent);
  if (!payload) return false;
  const addr = payload.resolved_addresses?.ada;
  return addr === multisigAddress;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!ALLOWED_NETWORKS.includes(network)) {
    throw new Error(
      `usage: --network <${ALLOWED_NETWORKS.join("|")}> [--blockfrost-api-key <k>] [--policy-key <bech32-xprv>] [--dry-run] [--skip-reserve] [--skip-attach]`
    );
  }

  const blockfrostApiKey = (args["blockfrost-api-key"] || process.env.BLOCKFROST_API_KEY || "").trim();
  const policyKeyBech32 = (args["policy-key"] || process.env.POLICY_KEY || "").trim();
  const userAgent = (process.env.KORA_USER_AGENT || "kora-cutover/1.0").trim();
  const dryRun = args["dry-run"] === "true";
  const skipReserve = args["skip-reserve"] === "true";
  const skipAttach = args["skip-attach"] === "true";

  console.log(`Phase E cutover orchestrator: network=${network}`);
  if (dryRun) console.log("DRY RUN — no DynamoDB writes, no Cardano submits.");
  if (skipReserve) console.log("--skip-reserve set: assuming reservations already inserted.");
  if (skipAttach) console.log("--skip-attach set: stopping after the wait phase.");

  // ---- Step 1: reservations ----
  if (!skipReserve) {
    console.log("\n[1/4] Reserving mints in the minting engine...");
    const reservations = await reserveAllSettingsHandles({
      network,
      userAgent,
      dryRun,
    });
    for (const r of reservations) {
      const summary = r.status === "error" ? `error — ${r.error}` : r.status;
      console.log(`  ${r.handle}: ${summary}`);
    }
    if (reservations.some((r) => r.status === "error")) {
      throw new Error("one or more reservations failed; aborting");
    }
  } else {
    console.log("\n[1/4] Skipped reservations.");
  }

  // ---- Step 2: wait for mints ----
  console.log("\n[2/4] Waiting for mints to land on-chain...");
  if (dryRun) {
    console.log("  (dry-run) skipping poll");
  } else {
    for (const handle of SETTINGS_HANDLES) {
      await waitForHandleOnChain(handle, network, userAgent);
    }
    console.log(`  Buffering ${BLOCKFROST_INDEXING_BUFFER_MS / 1000}s for Blockfrost indexing...`);
    await sleep(BLOCKFROST_INDEXING_BUFFER_MS);
  }

  if (skipAttach) {
    console.log("\n[3/4] --skip-attach: stopping before datum-attach phase.");
    console.log("\nDone.");
    return;
  }

  // ---- Step 3: build datums + attach txs ----
  console.log("\n[3/4] Building datum-attach txs...");

  if (!dryRun && !blockfrostApiKey) {
    throw new Error(
      "BLOCKFROST_API_KEY (env or --blockfrost-api-key) is required for the attach step"
    );
  }
  if (!dryRun && !policyKeyBech32) {
    throw new Error(
      "POLICY_KEY (env or --policy-key) is required for the attach step (signs with derivation 12)"
    );
  }

  const multisigAddress = await resolveMultisigAddress(network, userAgent);
  let deployerAddress;
  let deployerWallet = null;
  if (policyKeyBech32) {
    deployerWallet = getPolicyWallet({ policyKeyBech32, derivation: 12, network });
    deployerAddress = deployerWallet.address;
    if (deployerAddress !== RETURN_ADDRESS[network]) {
      throw new Error(
        `derived derivation-12 address ${deployerAddress} does not match RETURN_ADDRESS[${network}] ${RETURN_ADDRESS[network]} — POLICY_KEY mismatch?`
      );
    }
  } else {
    deployerAddress = RETURN_ADDRESS[network];
  }
  console.log(`  multisig (target):    ${multisigAddress}`);
  console.log(`  deployer (derivation 12): ${deployerAddress}${policyKeyBech32 ? "" : " (from RETURN_ADDRESS, key not loaded)"}`);

  // Source datums up front so dry-run shows the full plan.
  const settingsDatumHex = await sourceSettingsDatumHex(network, userAgent);
  const trieRoots = await fetchPartnersTrieRoots({ network });
  const datums = {
    [SETTINGS_HANDLE]: settingsDatumHex,
    [BG_HANDLE]: encodeRootHexAsByteArrayDatum(trieRoots.bg_root),
    [PFP_HANDLE]: encodeRootHexAsByteArrayDatum(trieRoots.pfp_root),
  };
  console.log(`  partners trie roots: source=${trieRoots.source} bg=${trieRoots.bg_root.slice(0, 16)}... pfp=${trieRoots.pfp_root.slice(0, 16)}...`);

  // Per-handle attach loop.
  const txResults = [];
  for (const handle of SETTINGS_HANDLES) {
    console.log(`\n  ${handle}:`);
    const inlineDatumHex = datums[handle];
    console.log(`    datum (${inlineDatumHex.length / 2} bytes): ${inlineDatumHex.slice(0, 32)}...`);

    if (!dryRun) {
      const alreadyAttached = await isAlreadyAttached(handle, network, userAgent, multisigAddress);
      if (alreadyAttached) {
        console.log(`    already at multisig address — skipping attach`);
        txResults.push({ handle, status: "already_attached" });
        continue;
      }
    }

    const ctx = dryRun
      ? { cborUtxos: [], handle, network, multisigAddress, deployerAddress }
      : await buildAttachContext({ handle, network, multisigAddress, deployerAddress, blockfrostApiKey });

    if (dryRun) {
      console.log(`    (dry-run) would build attach tx: ${handle} → ${multisigAddress}`);
      txResults.push({ handle, status: "dry_run", multisigAddress, deployerAddress });
      continue;
    }

    const built = await buildSettingsAttachTx({
      network,
      handleName: handle,
      inlineDatumHex,
      multisigAddress,
      deployerAddress,
      cborUtxos: ctx.cborUtxos,
      blockfrostApiKey,
    });
    console.log(`    unsigned tx: ${built.estimatedSignedTxSize}/${built.maxTxSize} bytes, txId=${built.txId}`);

    const signedHex = signTxWithWallet(built.cborHex, deployerWallet);
    console.log(`    signed (${signedHex.length / 2} bytes), submitting...`);
    const submittedTxHash = await submitTx({ network, signedTxCborHex: signedHex, blockfrostApiKey });
    console.log(`    submitted: ${submittedTxHash}`);
    txResults.push({ handle, status: "submitted", txHash: submittedTxHash, multisigAddress });
  }

  // ---- Step 4: verify ----
  console.log("\n[4/4] Verifying datums on-chain...");
  if (dryRun) {
    console.log("  (dry-run) skipping verification");
  } else {
    console.log(`  Buffering ${BLOCKFROST_INDEXING_BUFFER_MS / 1000}s for tx confirmation...`);
    await sleep(BLOCKFROST_INDEXING_BUFFER_MS);
    for (const handle of SETTINGS_HANDLES) {
      const liveDatumHex = await fetchHandleDatumHex(handle, network, userAgent);
      const expectedDecoded = cbor.decodeFirstSync(Buffer.from(datums[handle], "hex"));
      const liveDecoded = cbor.decodeFirstSync(Buffer.from(liveDatumHex, "hex"));
      const match = JSON.stringify(expectedDecoded) === JSON.stringify(liveDecoded);
      console.log(`  ${handle}: on-chain datum ${match ? "MATCHES" : "DIFFERS"}`);
      if (!match) {
        throw new Error(`${handle} on-chain datum does not match expected`);
      }
    }
  }

  console.log("\nPhase E cutover complete.");
  console.log(JSON.stringify({ network, multisigAddress, txResults, trieRoots }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

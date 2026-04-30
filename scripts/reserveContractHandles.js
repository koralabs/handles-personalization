#!/usr/bin/env node
//
// Reserve mints for the V3 deployment SubHandles:
//   pers_logic1@handlecontract
//   pers_proxy1@handlecontract
//
// Mirrors scripts/reserveSettingsHandles.js but for the contract-handle
// namespace (handlecontract, ordinal-1 — the deployment YAML uses
// `contract_slug_ordinal` format which always starts at 1 for a fresh slug).
//
// What it does (per handle):
//   1. Skips if already minted on chain (api.handle.me 200).
//   2. Submits a self-payment anchor tx at derivation 12 (the kora-team
//      deployer wallet that holds @handlecontract) — required because the
//      minting engine demands a real, unique txHash on every paid session.
//   3. Inserts a `paid` / `cost: 0` / `paymentAddress: 'already_paid'` row
//      into minting_engine_sessions_<network>. Engine cron picks it up and
//      mints the SubHandle to RETURN_ADDRESS[network] (= derivation 12).
//
// AWS creds come from the inherited user-folder defaults (~/.aws/...).
// POLICY_KEY (env or --policy-key) is required to sign anchor txs.
//
// Usage:
//   node scripts/reserveContractHandles.js --network preview \
//        [--policy-key <bech32 xprv>]    (or POLICY_KEY env)
//        [--blockfrost-api-key <key>]    (or BLOCKFROST_API_KEY env)
//        [--dry-run]                     (skip dynamo write + anchor submit)

import { readFileSync } from "node:fs";

import {
  ALLOWED_NETWORKS,
  RETURN_ADDRESS,
  buildSessionItem,
  checkHandleAlreadyMinted,
  handlesApiBaseUrlForNetwork,
  sessionsTableForNetwork,
} from "./reserveSettingsHandles.js";
import { submitAnchorSelfTx } from "../helpers/cardano-sdk/anchorTx.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// Per adahandle-deployments/docs/contract-deployment-pipeline.md the
// canonical slug shape is `<app><role>[<extra>]` with no separators and
// ≤10 chars. The `pers` app expands to:
//   persprx — proxy (the spend script being delegated to)
//   perspz  — Personalize-variant logic
//   perslfc — lifecycle-variant logic (Migrate/Revoke/Update/ReturnToSender)
// All three need to land in pz_settings.valid_contracts.
//
// Pre-split mints (pers_logic1, pers_proxy1) are stranded but benign — they
// don't correspond to any deployed validator.
const CONTRACT_HANDLES = [
  "persprx1@handlecontract",
  "perspz1@handlecontract",
  "perslfc1@handlecontract",
];

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
  const userAgent = "kora-cutover/1.0";

  if (!dryRun) {
    if (!policyKeyBech32) throw new Error("POLICY_KEY is required (anchor-tx signer)");
    if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY is required (utxo + submit)");
  }

  console.log(`Reserving V3 contract handles on ${network}:`);
  for (const h of CONTRACT_HANDLES) console.log(`  ${h}`);
  if (dryRun) console.log("DRY RUN — no anchor txs, no DynamoDB writes.");

  const wallet = !dryRun ? getPolicyWallet({ policyKeyBech32, derivation: 12, network }) : null;
  if (wallet) console.log(`Anchor wallet (d12): ${wallet.address}`);

  const tableName = sessionsTableForNetwork(network);
  const dynamo = !dryRun ? DynamoDBDocumentClient.from(new DynamoDBClient({})) : null;

  const results = [];
  for (const handle of CONTRACT_HANDLES) {
    const apiUrl = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}`;
    if (await checkHandleAlreadyMinted(handle, network, userAgent)) {
      console.log(`  ${handle}: ALREADY ON CHAIN (skip)`);
      results.push({ handle, status: "existing_on_chain" });
      continue;
    }

    if (dryRun) {
      results.push({ handle, status: "dry_run" });
      console.log(`  ${handle}: would reserve (dry-run)`);
      continue;
    }

    console.log(`  ${handle}: submitting anchor self-payment...`);
    const anchor = await submitAnchorSelfTx({ network, wallet, blockfrostApiKey });
    const txHash = typeof anchor === "string" ? anchor : anchor.txHash;
    console.log(`    anchor txHash: ${txHash}`);

    const item = buildSessionItem({ handle, network, txHash });
    try {
      await dynamo.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
      console.log(`    session row inserted`);
      results.push({ handle, status: "session_created", txHash, returnAddress: RETURN_ADDRESS[network] });
    } catch (err) {
      if (err && err.name === "ConditionalCheckFailedException") {
        console.log(`    session row already exists (skip)`);
        results.push({ handle, status: "existing_session" });
        continue;
      }
      throw err;
    }
  }

  console.log("");
  console.log(JSON.stringify({ network, table: tableName, returnAddress: RETURN_ADDRESS[network], items: results }, null, 2));
  console.log(
    `\nNext: wait for the minting engine cron to pick up these sessions ` +
      `(typically <2 min). Poll ${handlesApiBaseUrlForNetwork(network)}/handles/<name> ` +
      `until each returns 200, then run the deploy script (TBD: deployContractRefScripts.js).`
  );
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

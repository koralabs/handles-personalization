#!/usr/bin/env node
//
// Phase E mint reservation: inserts the three settings handles
// (pers@handle_settings, pers_bg@handle_settings, pers_pfp@handle_settings)
// into the minting engine's DynamoDB session table as `cost: 0` /
// `paymentAddress: 'already_paid'` rows so the engine cron picks them up
// and mints them to derivation 12 (the kora-team admin wallet — same
// address that holds @handlecontract and kora@handle_prices).
//
// Pattern verbatim from the deleted adahandle-internal/minthandles-cli
// (commit b02150e^), which the modern DynamoDB-driven minting engine still
// accepts: getPaidPendingSessions filters by status alone, no
// paymentAddress content check anywhere in the cron.
//
// Step 1 of 2 in the Phase E cutover sequence. Step 2 = settingsAttachTx.js
// re-locates each minted handle from derivation 12 to the multisig
// native-script address with the inline datum attached.
//
// AWS creds come from the inherited user-folder defaults (~/.aws/...).
// No env vars required.
//
// Usage:
//   node scripts/reserveSettingsHandles.js --network <preview|preprod|mainnet>
//
// Optional:
//   --user-agent <ua>    Override the api.handle.me User-Agent header.
//   --dry-run            Print what would be inserted; no DynamoDB write.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ALLOWED_NETWORKS = ["preview", "preprod", "mainnet"];
const ACTIVE_SESSIONS_TABLE_BASE = "minting_engine_sessions";
const ACTIVE_SESSION_SK = "ACTIVE_SESSION";
const HANDLES = [
  "pers@handle_settings",
  "pers_bg@handle_settings",
  "pers_pfp@handle_settings",
];

// Derivation 12 of POLICY_KEY = the kora-team admin wallet that holds
// @handlecontract root + kora@handle_prices on each network. Verified by
// looking up those handles via api.handle.me on 2026-04-28. Documented in
// minting.handle.me/src/helpers/cardano/wallet.ts (lines 28-34, "12 = Handle
// Prices") and src/helpers/constants.ts (getHandlecontractPaymentAddress).
//
// Note: preview and preprod share the same testnet derivation-12 address
// (same xprv, same network ID for testnet purposes). Mainnet differs.
const RETURN_ADDRESS = {
  preview: "addr_test1vqwg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqgs8ql0",
  preprod: "addr_test1vqwg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqgs8ql0",
  mainnet: "addr1vywg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqncnus2",
};

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

// minting_engine_sessions for mainnet, minting_engine_sessions_<network>
// otherwise — matches buildTableName from the deleted CLI and the engine's
// own per-network table convention.
const tableNameForNetwork = (network) =>
  network === "mainnet" ? ACTIVE_SESSIONS_TABLE_BASE : `${ACTIVE_SESSIONS_TABLE_BASE}_${network}`;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    if (token === "--dry-run") {
      args["dry-run"] = "true";
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

const checkHandleAlreadyMinted = async (handle, network, userAgent) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`handle pre-flight check for ${handle} failed: HTTP ${response.status}`);
  }
  return true;
};

const buildSessionItem = (handle, network) => ({
  pk: handle,
  sk: ACTIVE_SESSION_SK,
  handle,
  assetName: Buffer.from(handle, "utf8").toString("hex"),
  attempts: 0,
  cost: 0,
  dateAdded: Date.now(),
  start: Date.now(),
  status: "paid",
  paymentAddress: "already_paid",
  returnAddress: RETURN_ADDRESS[network],
  createdBySystem: "CLI",
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!ALLOWED_NETWORKS.includes(network)) {
    throw new Error(
      `usage: --network <${ALLOWED_NETWORKS.join("|")}> [--user-agent <ua>] [--dry-run]`
    );
  }
  const userAgent = (args["user-agent"] || "kora-cutover/1.0").trim();
  const dryRun = args["dry-run"] === "true";
  const tableName = tableNameForNetwork(network);
  const returnAddress = RETURN_ADDRESS[network];

  console.log(`Phase E reservation: network=${network}, table=${tableName}, returnAddress=${returnAddress}`);
  if (dryRun) console.log("DRY RUN — no DynamoDB writes.");

  const client = dryRun ? null : DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const results = [];

  for (const handle of HANDLES) {
    const result = { handle, network, table: tableName };
    try {
      const exists = await checkHandleAlreadyMinted(handle, network, userAgent);
      if (exists) {
        result.status = "existing_on_chain";
        results.push(result);
        console.log(`  ${handle}: existing_on_chain — skipping reservation`);
        continue;
      }

      const item = buildSessionItem(handle, network);
      if (dryRun) {
        result.status = "dry_run";
        result.item = item;
        results.push(result);
        console.log(`  ${handle}: dry_run — would insert into ${tableName}`);
        continue;
      }

      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(pk)",
          })
        );
        result.status = "session_created";
        result.returnAddress = returnAddress;
        results.push(result);
        console.log(`  ${handle}: session_created — engine cron will mint to ${returnAddress}`);
      } catch (err) {
        if (err && err.name === "ConditionalCheckFailedException") {
          result.status = "existing_session";
          results.push(result);
          console.log(`  ${handle}: existing_session — pk already present in ${tableName}`);
          continue;
        }
        throw err;
      }
    } catch (err) {
      result.status = "error";
      result.error = err instanceof Error ? err.message : String(err);
      results.push(result);
      console.error(`  ${handle}: error — ${result.error}`);
    }
  }

  console.log("");
  console.log(JSON.stringify({ network, table: tableName, returnAddress, items: results }, null, 2));

  if (results.some((r) => r.status === "error")) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

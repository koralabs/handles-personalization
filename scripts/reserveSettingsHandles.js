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
// Step 1 of the Phase E cutover. Step 2 = settingsAttachTx.js re-locates
// each minted handle from derivation 12 to the multisig native-script
// address with the inline datum attached. The runPhaseECutover.js
// orchestrator imports `reserveAllSettingsHandles` to do the whole loop.
//
// AWS creds come from the inherited user-folder defaults (~/.aws/...).
// No env vars required.
//
// CLI usage:
//   node scripts/reserveSettingsHandles.js --network <preview|preprod|mainnet>
//
// Optional:
//   --user-agent <ua>    Override the api.handle.me User-Agent header.
//   --dry-run            Print what would be inserted; no DynamoDB write.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export const ALLOWED_NETWORKS = ["preview", "preprod", "mainnet"];
const ACTIVE_SESSIONS_TABLE_BASE = "minting_engine_sessions";
const ACTIVE_SESSION_SK = "ACTIVE_SESSION";

export const SETTINGS_HANDLES = [
  "pers@handle_settings",
  "pers_bg@handle_settings",
  "pers_pfp@handle_settings",
];

// Derivation 12 of POLICY_KEY = the kora-team admin wallet that holds
// @handlecontract root + kora@handle_prices on each network. Verified by
// looking up those handles via api.handle.me on 2026-04-28 *and* by deriving
// directly from POLICY_KEY through helpers/cardano-sdk/policyKeyWallet.js.
//
// preview + preprod share the same testnet derivation-12 address (same xprv,
// network ID 0). Mainnet differs (network ID 1).
export const RETURN_ADDRESS = {
  preview: "addr_test1vqwg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqgs8ql0",
  preprod: "addr_test1vqwg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqgs8ql0",
  mainnet: "addr1vywg4hlph5k947cqt88xlryxk6ufl9qymac33dr4aenmhrqncnus2",
};

export const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

// minting_engine_sessions for mainnet, minting_engine_sessions_<network>
// otherwise — matches buildTableName from the deleted CLI and the engine's
// own per-network table convention.
export const sessionsTableForNetwork = (network) =>
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

export const checkHandleAlreadyMinted = async (handle, network, userAgent, fetchFn = fetch) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}`;
  const response = await fetchFn(url, { headers: { "User-Agent": userAgent } });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`handle pre-flight check for ${handle} failed: HTTP ${response.status}`);
  }
  return true;
};

// The minting engine requires a real `txHash` on every PAID row (commit
// f22ef67f in minting.handle.me — "fixing free mints" — added a
// malformed-removal filter that deletes any PAID row where
// `!session.txHash`). For free-mint sessions the engine doesn't validate
// the txHash against on-chain payment data, but it does require the field
// to be set, and the tx_hash_gsi means it has to be unique across active
// sessions.
//
// The Phase E orchestrator satisfies this by submitting one real on-chain
// anchor tx per handle (a self-payment at derivation 12) and passing the
// resulting txHash here. Each session row therefore points at a real,
// auditable on-chain transaction — no placeholders.
export const buildSessionItem = ({ handle, network, txHash }) => {
  if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash)) {
    throw new Error(`buildSessionItem: txHash must be a 64-char hex tx hash, got: ${txHash}`);
  }
  return {
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
    txHash: txHash.toLowerCase(),
    createdBySystem: "CLI",
  };
};

// Reserve a single handle. Caller must supply a real on-chain `txHash`
// (typically the hash of a self-payment anchor tx at derivation 12 — see
// helpers/cardano-sdk/anchorTx.js).
//
// Returns one of:
//   { status: 'existing_on_chain' }
//   { status: 'session_created', returnAddress, txHash }
//   { status: 'existing_session' }
//   { status: 'dry_run', item }
export const reserveSettingsHandle = async ({
  handle,
  network,
  txHash,
  userAgent = "kora-cutover/1.0",
  dryRun = false,
  dynamoClient,
  fetchFn = fetch,
}) => {
  if (!ALLOWED_NETWORKS.includes(network)) {
    throw new Error(`unknown network: ${network}`);
  }
  if (!txHash) {
    throw new Error("reserveSettingsHandle: txHash is required (anchor-tx hash)");
  }

  const tableName = sessionsTableForNetwork(network);
  const exists = await checkHandleAlreadyMinted(handle, network, userAgent, fetchFn);
  if (exists) {
    return { handle, network, table: tableName, status: "existing_on_chain" };
  }

  const item = buildSessionItem({ handle, network, txHash });
  if (dryRun) {
    return { handle, network, table: tableName, status: "dry_run", item };
  }

  const client = dynamoClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
    return {
      handle,
      network,
      table: tableName,
      status: "session_created",
      returnAddress: RETURN_ADDRESS[network],
      txHash: item.txHash,
    };
  } catch (err) {
    if (err && err.name === "ConditionalCheckFailedException") {
      return { handle, network, table: tableName, status: "existing_session" };
    }
    throw err;
  }
};

// Reserve all three settings handles in sequence.
// `txHashByHandle` must be a map from handle name → 64-char hex tx hash,
// produced by the anchor-tx step of the orchestrator.
export const reserveAllSettingsHandles = async ({
  network,
  txHashByHandle = {},
  userAgent = "kora-cutover/1.0",
  dryRun = false,
  dynamoClient,
  fetchFn = fetch,
} = {}) => {
  const results = [];
  for (const handle of SETTINGS_HANDLES) {
    const txHash = txHashByHandle[handle];
    if (!txHash) {
      results.push({
        handle,
        network,
        table: sessionsTableForNetwork(network),
        status: "error",
        error: `txHashByHandle[${handle}] missing — caller must produce an anchor-tx hash`,
      });
      continue;
    }
    try {
      results.push(
        await reserveSettingsHandle({
          handle,
          network,
          txHash,
          userAgent,
          dryRun,
          dynamoClient,
          fetchFn,
        })
      );
    } catch (err) {
      results.push({
        handle,
        network,
        table: sessionsTableForNetwork(network),
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
};

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
  const tableName = sessionsTableForNetwork(network);
  const returnAddress = RETURN_ADDRESS[network];

  console.log(`Phase E reservation: network=${network}, table=${tableName}, returnAddress=${returnAddress}`);
  if (dryRun) console.log("DRY RUN — no DynamoDB writes.");

  const results = await reserveAllSettingsHandles({ network, userAgent, dryRun });
  for (const r of results) {
    const summary = r.status === "error" ? `error — ${r.error}` : r.status;
    console.log(`  ${r.handle}: ${summary}`);
  }

  console.log("");
  console.log(JSON.stringify({ network, table: tableName, returnAddress, items: results }, null, 2));

  if (results.some((r) => r.status === "error")) {
    process.exitCode = 1;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

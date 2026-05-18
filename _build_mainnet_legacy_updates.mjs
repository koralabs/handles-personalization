// Build THREE chained unsigned mainnet multisig settings-update txs to
// finalize the V3 personalization cutover on the LEGACY settings handles
// the V2 persprx still reads:
//
//   tx 1 — pz_settings.valid_contracts += four V3 hashes (so V2 persprx
//          accepts outputs to V3 persprx addresses during auto-migrate)
//   tx 2 — bg_policy_ids overwritten with the partner-trie bg_root
//          computed from partners_mainnet (now includes the 200 jpg-top-200
//          partners + whatever re-classifications were applied to the
//          legacy 37)
//   tx 3 — pfp_policy_ids overwritten with the partner-trie pfp_root
//
// Mainnet multisig is RequireMOf 2-of-4 (vs preprod's effective 1-of-2).
// Native script hash: d0496ab7c9be3c9947676328dbac37dcb39d0f0586a22f4ee9c49494
// Admin key-hashes (any 2 must sign):
//   0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d
//   fafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8
//   75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2
//   b5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa
//
// Source of truth: adahandle-deployments/tasks/tmp/mainnet-contract-migration/
//                  mainnet-wallet-payment-native-script.json
//
// The three txs are CHAINED — tx2 spends tx1's projected ada-only change,
// tx3 spends tx2's. Submit in order; if you batch-submit they'll race the
// same fee input and the chain will reject all but the first.

import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import cbor from "cbor";

import { buildSettingsUpdateTx } from "/home/jesse/src/koralabs/handles-personalization/settingsUpdateTx.js";
import { fetchPartnersTrieRoots } from "/home/jesse/src/koralabs/handles-personalization/helpers/dynamoPartnersRoots.js";

const NETWORK = "mainnet";

const MAINNET_NATIVE_SCRIPT_CBOR_HEX =
  "830302848200581c0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d" +
  "8200581cfafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8" +
  "8200581c75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2" +
  "8200581cb5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa";

const USER_AGENT = "kora-cutover/1.0";

// V3 hashes to add to legacy pz_settings.valid_contracts (idx 4).
// Identical across networks — validators are parameterless.
const V3_HASHES_TO_ADD = [
  "7cf105586f77934a524c9e78f8879a33460104f9578e9ac927f577e3", // persprx V3
  "7c99516a8151f27f45ac068f2593520a7987ca138998c041ec6e2d26", // perspz V3
  "23a2ef442a7c27260d20d6eaef37c5479468c4d7dab76ded6f01fa4c", // perslfc V3
  "fd65087a76a7d57a90714d279247beb6c2c99e9790f899a3153f2d2c", // persdsg V3
];

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const PREFIX_222 = "000de140";

const loadBlockfrostKey = () => {
  if (process.env.BLOCKFROST_API_KEY) return process.env.BLOCKFROST_API_KEY;
  try {
    // Mainnet network: read from the BFF's mainnet env (network-scoped),
    // never from minting.handle.me/.env (a single file that may be pointed
    // at any network at any time).
    for (const l of readFileSync("/home/jesse/src/koralabs/handle.me/bff/.env.mainnet.local", "utf8").split("\n")) {
      const m = l.match(/^BLOCKFROST_API_KEY=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  throw new Error("BLOCKFROST_API_KEY missing (set env var or bff/.env.mainnet.local)");
};

const fetchInlineDatumHex = async (handleName, blockfrostApiKey) => {
  const assetUnit =
    HANDLE_POLICY_ID + PREFIX_222 + Buffer.from(handleName, "utf8").toString("hex");
  const txRes = await fetch(
    `https://cardano-${NETWORK}.blockfrost.io/api/v0/assets/${assetUnit}/transactions?order=desc&count=1`,
    { headers: { project_id: blockfrostApiKey, "User-Agent": USER_AGENT } }
  );
  if (!txRes.ok) throw new Error(`fetch ${handleName} latest tx: ${txRes.status}`);
  const [{ tx_hash }] = await txRes.json();
  const utxoRes = await fetch(
    `https://cardano-${NETWORK}.blockfrost.io/api/v0/txs/${tx_hash}/utxos`,
    { headers: { project_id: blockfrostApiKey, "User-Agent": USER_AGENT } }
  );
  const out = (await utxoRes.json()).outputs.find((o) =>
    o.amount.some((a) => a.unit === assetUnit)
  );
  if (!out?.inline_datum) throw new Error(`${handleName} has no inline_datum`);
  return out.inline_datum;
};

const buildPzSettingsPatchedDatum = async (blockfrostApiKey) => {
  const oldDatumHex = await fetchInlineDatumHex("pz_settings", blockfrostApiKey);
  console.log(`  pz_settings current datum: ${oldDatumHex.length / 2} bytes`);
  const oldDatum = cbor.decodeFirstSync(Buffer.from(oldDatumHex, "hex"));
  if (!Array.isArray(oldDatum)) throw new Error(`pz_settings datum not an array`);
  if (oldDatum.length !== 9) throw new Error(`pz_settings expected 9-elem, got ${oldDatum.length}`);
  const validContracts = oldDatum[4];
  if (!Array.isArray(validContracts)) throw new Error(`pz_settings valid_contracts not a list`);
  const existing = new Set(validContracts.map((b) => Buffer.isBuffer(b) ? b.toString("hex") : String(b)));
  const toAdd = V3_HASHES_TO_ADD.filter((h) => !existing.has(h));
  if (toAdd.length === 0) {
    console.log(`  pz_settings: V3 hashes already present — skipping`);
    return null;
  }
  console.log(`  pz_settings: existing valid_contracts has ${validContracts.length} entries`);
  console.log(`  pz_settings: adding ${toAdd.length} V3 hashes:`);
  toAdd.forEach((h) => console.log(`    ${h}`));
  const patched = [...oldDatum];
  patched[4] = [...validContracts, ...toAdd.map((h) => Buffer.from(h, "hex"))];
  return cbor.encode(patched).toString("hex");
};

const buildRootPatchedDatum = (rootHex, label) => {
  const buf = Buffer.from(rootHex, "hex");
  if (buf.length !== 32) throw new Error(`${label} root must be 32 bytes, got ${buf.length}`);
  return cbor.encode(buf).toString("hex");
};

const summarizeChange = (changeUtxo) => {
  if (!changeUtxo) return "(no ada-only change output)";
  const [txIn, txOut] = changeUtxo;
  return `${txIn.txId}#${txIn.index}  lovelace=${txOut.value.coins}`;
};

// Fetch the multisig wallet's clean (no-asset) UTxOs from Blockfrost.
// Sort by lovelace descending so we can assign the largest UTxOs first.
const fetchMultisigCleanUtxos = async (blockfrostApiKey) => {
  const { fetchBlockfrostUtxos } = await import("./helpers/cardano-sdk/blockfrostUtxo.js");
  const MULTISIG_ADDRESS =
    "addr1x8gyj64hexlrex28va3j3kavxlwt88g0qkr2yt6wa8zff9pwn0ud438rhxc06hnnsl8jxa6xdnc60dgqrqm0n5nre4ws0qt2wn";
  const utxos = await fetchBlockfrostUtxos(MULTISIG_ADDRESS, blockfrostApiKey, NETWORK);
  return utxos
    .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
    .sort((a, b) => Number((b[1].value.coins ?? 0n) - (a[1].value.coins ?? 0n)));
};

const utxoRefOf = ([txIn]) => `${txIn.txId}#${txIn.index}`;

const main = async () => {
  const blockfrostApiKey = loadBlockfrostKey();

  console.log("Computing partner trie roots from partners_mainnet...");
  const trieRoots = await fetchPartnersTrieRoots({ network: NETWORK });
  console.log(`  source: ${trieRoots.source}`);
  console.log(`  bg_root:  ${trieRoots.bg_root}`);
  console.log(`  pfp_root: ${trieRoots.pfp_root}`);

  // Each unsigned tx must reference only UTxOs that already exist on chain
  // at signing time. The earlier chained build (tx2 spends tx1's projected
  // change) breaks hardware wallets and any signer that resolves input
  // values via Blockfrost: the projected-change input doesn't exist until
  // tx1 lands, so the signer reports "Unable to calculate an accurate
  // transaction balance due to unknown inputs."
  //
  // Build each tx as INDEPENDENT — assign a distinct on-chain ada-only
  // multisig UTxO as the fee input, and exclude the other txs' fee UTxOs
  // from each tx's selector pool so the input selector can't accidentally
  // double-spend.
  console.log("\nFetching multisig clean UTxOs for independent-tx assignment...");
  const cleanUtxos = await fetchMultisigCleanUtxos(blockfrostApiKey);
  if (cleanUtxos.length < 3) {
    throw new Error(
      `need at least 3 ada-only UTxOs at multisig, found ${cleanUtxos.length}. Topup d12 → multisig from a minting wallet before re-running.`
    );
  }
  const [feeUtxoTx1, feeUtxoTx2, feeUtxoTx3] = cleanUtxos.slice(0, 3);
  console.log(`  tx1 fee utxo: ${utxoRefOf(feeUtxoTx1)} (${feeUtxoTx1[1].value.coins} lovelace)`);
  console.log(`  tx2 fee utxo: ${utxoRefOf(feeUtxoTx2)} (${feeUtxoTx2[1].value.coins} lovelace)`);
  console.log(`  tx3 fee utxo: ${utxoRefOf(feeUtxoTx3)} (${feeUtxoTx3[1].value.coins} lovelace)`);

  const ref1 = utxoRefOf(feeUtxoTx1);
  const ref2 = utxoRefOf(feeUtxoTx2);
  const ref3 = utxoRefOf(feeUtxoTx3);

  // ---- TX 1: legacy pz_settings — append V3 hashes to valid_contracts ----
  console.log("\n=== TX 1/3: legacy pz_settings — add V3 hashes ===");
  const pzPatchedDatumHex = await buildPzSettingsPatchedDatum(blockfrostApiKey);
  if (!pzPatchedDatumHex) {
    console.log("Nothing to do for pz_settings; aborting.");
    process.exit(1);
  }
  const tx1 = await buildSettingsUpdateTx({
    network: NETWORK,
    settingsHandleName: "pz_settings",
    patchedDatumHex: pzPatchedDatumHex,
    nativeScriptCborHex: MAINNET_NATIVE_SCRIPT_CBOR_HEX,
    blockfrostApiKey,
    userAgent: USER_AGENT,
    additionalPreSelectedUtxos: [feeUtxoTx1],
    excludeFromRemainingUtxos: [ref2, ref3],
  });
  console.log(`  txId: ${tx1.txId}`);
  console.log(`  size: ${tx1.estimatedSignedTxSize}/${tx1.maxTxSize}`);
  console.log(`  inputs consumed: ${[...tx1.consumedInputs].join(", ")}`);
  writeFileSync("/tmp/mainnet-legacy-pz_settings-unsigned.tx.cbor.hex", tx1.cborHex);

  // ---- TX 2: legacy bg_policy_ids — overwrite with bg_root ----
  console.log("\n=== TX 2/3: legacy bg_policy_ids — overwrite with bg_root ===");
  const bgPatchedDatumHex = buildRootPatchedDatum(trieRoots.bg_root, "bg");
  const tx2 = await buildSettingsUpdateTx({
    network: NETWORK,
    settingsHandleName: "bg_policy_ids",
    patchedDatumHex: bgPatchedDatumHex,
    nativeScriptCborHex: MAINNET_NATIVE_SCRIPT_CBOR_HEX,
    blockfrostApiKey,
    userAgent: USER_AGENT,
    additionalPreSelectedUtxos: [feeUtxoTx2],
    excludeFromRemainingUtxos: [ref1, ref3],
  });
  console.log(`  txId: ${tx2.txId}`);
  console.log(`  size: ${tx2.estimatedSignedTxSize}/${tx2.maxTxSize}`);
  console.log(`  inputs consumed: ${[...tx2.consumedInputs].join(", ")}`);
  writeFileSync("/tmp/mainnet-legacy-bg_policy_ids-unsigned.tx.cbor.hex", tx2.cborHex);

  // ---- TX 3: legacy pfp_policy_ids — overwrite with pfp_root ----
  console.log("\n=== TX 3/3: legacy pfp_policy_ids — overwrite with pfp_root ===");
  const pfpPatchedDatumHex = buildRootPatchedDatum(trieRoots.pfp_root, "pfp");
  const tx3 = await buildSettingsUpdateTx({
    network: NETWORK,
    settingsHandleName: "pfp_policy_ids",
    patchedDatumHex: pfpPatchedDatumHex,
    nativeScriptCborHex: MAINNET_NATIVE_SCRIPT_CBOR_HEX,
    blockfrostApiKey,
    userAgent: USER_AGENT,
    additionalPreSelectedUtxos: [feeUtxoTx3],
    excludeFromRemainingUtxos: [ref1, ref2],
  });
  console.log(`  txId: ${tx3.txId}`);
  console.log(`  size: ${tx3.estimatedSignedTxSize}/${tx3.maxTxSize}`);
  console.log(`  inputs consumed: ${[...tx3.consumedInputs].join(", ")}`);
  writeFileSync("/tmp/mainnet-legacy-pfp_policy_ids-unsigned.tx.cbor.hex", tx3.cborHex);

  // Sanity check: confirm no UTxO is referenced by more than one tx.
  const allInputs = [];
  for (const [label, tx] of [["tx1", tx1], ["tx2", tx2], ["tx3", tx3]]) {
    for (const ref of tx.consumedInputs) allInputs.push([label, ref]);
  }
  const dups = allInputs.filter((entry, i, arr) => arr.findIndex(([, r]) => r === entry[1]) !== i);
  if (dups.length > 0) {
    throw new Error(`UTxO collision across txs: ${JSON.stringify(dups)} — should never happen given excludeFromRemainingUtxos`);
  }

  console.log(`
=== Three unsigned MAINNET txs saved (sign + submit IN ANY ORDER): ===
  1. /tmp/mainnet-legacy-pz_settings-unsigned.tx.cbor.hex     (${tx1.txId})
  2. /tmp/mainnet-legacy-bg_policy_ids-unsigned.tx.cbor.hex   (${tx2.txId})
  3. /tmp/mainnet-legacy-pfp_policy_ids-unsigned.tx.cbor.hex  (${tx3.txId})

Multisig: RequireMOf 2-of-4. ANY TWO of these admin keys must sign each tx:
  0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d
  fafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8
  75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2
  b5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa

Each tx is INDEPENDENT — different on-chain fee UTxO, no chained projected
change. Sign and submit in any order; hardware-wallet-compatible.`);
};

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });

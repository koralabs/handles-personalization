#!/usr/bin/env node
//
// Build an unsigned multisig tx that redeploys the perspz V3 reference
// script at perspz1@handlecontract on mainnet. The SubHandle UTxO is at
// the Kora 2-of-4 multisig; this script spends it (with native-script
// witness) and re-outputs at the same multisig with the freshly-compiled
// perspz cbor attached as a reference script.
//
// Pair this with scripts/addPerspz2HashToValidContracts.js — first add the
// new perspz hash to pz_settings.valid_contracts so persprx accepts the
// new perspz observer, then sign + submit this redeploy. Either order is
// safe (old perspz stays in valid_contracts so in-flight personalize
// builds keep working until BFF picks the new perspz as latest).
//
// Usage:
//   node scripts/redeployPerspzAtMultisig.js --network mainnet \
//        --blockfrost-api-key <key>   (or BLOCKFROST_API_KEY env)
//
// Output:
//   /tmp/redeployPerspz-<network>-unsigned.tx.cbor.hex
// + multisig signer instructions printed to stdout.

import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import sodium from "libsodium-wrappers-sumo";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";

const PERSPZ_HANDLE = "perspz1@handlecontract";

const NATIVE_SCRIPT_BY_NETWORK = {
  preview:
    "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b" +
    "8200581cd9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d",
  preprod:
    "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b" +
    "8200581c548afd43158ec53fcd94290c41d1b4496c0746617f0efbb974440bb4",
  mainnet:
    "830302848200581c0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d" +
    "8200581cfafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8" +
    "8200581c75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2" +
    "8200581cb5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa",
};

const SIGNER_INSTRUCTIONS = {
  preview:
    "Multisig (1-of-2 RequireAnyOf) signers on preview:\n" +
    "  5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b\n" +
    "  d9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d\n" +
    "Either key adds a vkey witness, then submit.",
  preprod:
    "Multisig (1-of-2 RequireAnyOf) signers on preprod:\n" +
    "  5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b\n" +
    "  548afd43158ec53fcd94290c41d1b4496c0746617f0efbb974440bb4\n" +
    "Either key adds a vkey witness, then submit.",
  mainnet:
    "Multisig (2-of-4 RequireAtLeast) signers on mainnet:\n" +
    "  0d147948e63cf418abccbc8e53f1f759b0e2375ba7cc07b351d09c9d\n" +
    "  fafa11964fda9a4ec829d9cc6fcc98bae73621a10b0be64cf7a91db8\n" +
    "  75cca35458a485e3c61d3803da366933424628e47c335a32d2cbbac2\n" +
    "  b5fa099804ba14c5494dc97ddc15e114043704c6ad90ac87d7d805aa\n" +
    "Any TWO keys add vkey witnesses, then submit.",
};

const PLUTUS_JSON =
  "/home/jesse/src/koralabs/handles-personalization/aiken/plutus.json";

const computeV3Hash = async (cborHex) => {
  await sodium.ready;
  const tagged = Buffer.concat([
    Buffer.from([0x03]),
    Buffer.from(cborHex, "hex"),
  ]);
  return Buffer.from(sodium.crypto_generichash(28, tagged)).toString("hex");
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!["preview", "preprod", "mainnet"].includes(network)) {
    throw new Error(`usage: --network <preview|preprod|mainnet>`);
  }
  const blockfrostApiKey =
    (args["blockfrost-api-key"] || process.env.BLOCKFROST_API_KEY || "").trim();
  if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY required");
  const userAgent = "kora-cutover/1.0";

  // 1. Load freshly-compiled perspz CBOR from plutus.json
  const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const perspz = blueprint.validators.find(
    (v) => v.title === "perspz.perspz.withdraw"
  );
  if (!perspz?.compiledCode) {
    throw new Error("perspz.perspz.withdraw missing from plutus.json — run aiken build first");
  }
  const newPerspzCbor = perspz.compiledCode;
  const newPerspzHash = await computeV3Hash(newPerspzCbor);
  console.log(`new perspz hash: ${newPerspzHash} (${newPerspzCbor.length / 2} bytes)`);

  // 2. Verify the freshly-compiled hash is NOT the currently deployed one
  //    AND grab the byte count of the existing ref-script for fee padding.
  //    Use the LBL_222 owner UTxO (returned by /handles/<name>.utxo) — that's
  //    the multisig-held UTxO carrying the Plutus reference script. The
  //    LBL_100 reference token (/reference_token endpoint) carries the
  //    SubHandle metadata + inline datum, NOT the ref-script bytes.
  //    Path: api → handleData.utxo → Blockfrost /utxos → output's
  //    reference_script_hash, then /scripts/<hash>/cbor → byte size.
  const apiHost = network === "mainnet" ? "api.handle.me" : `${network}.api.handle.me`;
  const handleRes = await fetch(`https://${apiHost}/handles/${encodeURIComponent(PERSPZ_HANDLE)}`);
  if (!handleRes.ok) {
    throw new Error(`failed to fetch ${PERSPZ_HANDLE}: HTTP ${handleRes.status}`);
  }
  const handleData = await handleRes.json();
  const utxoRef = handleData?.utxo;
  if (!utxoRef || !utxoRef.includes("#")) {
    throw new Error(`api returned malformed handleData.utxo: ${utxoRef}`);
  }
  const [utxoTxHash, utxoIndexStr] = utxoRef.split("#");
  const utxoIndex = Number.parseInt(utxoIndexStr, 10);
  const utxosResp = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/txs/${utxoTxHash}/utxos`,
    { headers: { project_id: blockfrostApiKey } });
  if (!utxosResp.ok) throw new Error(`Blockfrost /txs/${utxoTxHash}/utxos: HTTP ${utxosResp.status}`);
  const utxosJson = await utxosResp.json();
  const onChainOutput = utxosJson.outputs?.find((o) => o.output_index === utxoIndex);
  if (!onChainOutput) throw new Error(`output ${utxoRef} not found in tx outputs`);
  const currentScriptHash = onChainOutput.reference_script_hash ?? null;
  if (!currentScriptHash) {
    throw new Error(`UTxO ${utxoRef} has no reference_script_hash — nothing to redeploy`);
  }
  if (currentScriptHash === newPerspzHash) {
    console.log(`Current ${PERSPZ_HANDLE} ref-script hash (${currentScriptHash}) matches freshly-compiled — nothing to do.`);
    return;
  }
  console.log(`current ${PERSPZ_HANDLE} ref-script hash: ${currentScriptHash} (will be replaced)`);

  // 2b. Fetch the on-chain ref-script bytes so buildSettingsUpdateTx can
  //     pad the fee for Conway's minFeeRefScriptCoinsPerByte on the input
  //     ref-script being consumed. cardano-sdk 0.46.12's fee estimator
  //     doesn't include input ref-script bytes; without this padding,
  //     submission fails with "Insufficient fee" (observed previously:
  //     shortfall ~14039 bytes × 15 lovelace/byte ≈ 210 k lovelace).
  let inputRefScriptBytes = 0;
  const sizeResp = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/scripts/${currentScriptHash}/cbor`,
    { headers: { project_id: blockfrostApiKey } });
  if (sizeResp.ok) {
    const { cbor: scriptCborHex } = await sizeResp.json();
    if (typeof scriptCborHex === "string") {
      inputRefScriptBytes = scriptCborHex.length / 2;
    }
  }
  if (inputRefScriptBytes === 0) {
    throw new Error(`failed to fetch existing ref-script (${currentScriptHash}) size from Blockfrost — fee padding would underflow`);
  }
  console.log(`input ref-script bytes (for fee padding): ${inputRefScriptBytes}`);

  // 3. Build the multisig tx via buildSettingsUpdateTx with no datum,
  //    just a new scriptReference. The function spends the SubHandle UTxO
  //    at the multisig and re-outputs at the same multisig with the new
  //    ref script attached.
  const scriptReference = {
    __type: "plutus",
    bytes: newPerspzCbor.startsWith("0x") ? newPerspzCbor.slice(2) : newPerspzCbor,
    version: 2, // cardano-sdk PlutusLanguageVersion: 0=V1, 1=V2, 2=V3
  };
  console.log(`Building multisig redeploy tx for ${PERSPZ_HANDLE} on ${network}...`);
  const built = await buildSettingsUpdateTx({
    network,
    settingsHandleName: PERSPZ_HANDLE,
    patchedDatumHex: undefined, // perspz1@handlecontract UTxO has no datum
    nativeScriptCborHex: NATIVE_SCRIPT_BY_NETWORK[network],
    blockfrostApiKey,
    userAgent,
    scriptReference,
    inputRefScriptBytes,
  });
  console.log(`  unsigned txId:        ${built.txId}`);
  console.log(`  estimated signed size: ${built.estimatedSignedTxSize}/${built.maxTxSize}`);

  // 4. Save unsigned cbor
  const outPath = `/tmp/redeployPerspz-${network}-unsigned.tx.cbor.hex`;
  writeFileSync(outPath, built.cborHex);
  console.log(`\n✓ Unsigned tx CBOR saved to ${outPath}`);
  console.log(`\n${SIGNER_INSTRUCTIONS[network]}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

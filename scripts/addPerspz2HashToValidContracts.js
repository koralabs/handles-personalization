#!/usr/bin/env node
//
// Build an unsigned multisig settings-update tx that appends ONLY the new
// perspz hash (the fixed perspz from update.ak commit daccf75 — Helios-
// faithful CIP-25 bg short-circuit) to pz_settings.valid_contracts on
// mainnet. The existing 4 V3 hashes + persdsg_hashes stay as-is.
//
// Pair with scripts/redeployPerspzAtMultisig.js. Order doesn't strictly
// matter (old perspz stays in valid_contracts), but the canonical sequence
// is: redeploy perspz first → add new hash here → BFF picks new perspz
// once api marks it latest.
//
// Usage:
//   node scripts/addPerspz2HashToValidContracts.js --network mainnet \
//        --blockfrost-api-key <key>   (or BLOCKFROST_API_KEY env)

import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import cbor from "cbor";
import sodium from "libsodium-wrappers-sumo";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";

const SETTINGS_HANDLE = "pz_settings";

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
  const tagged = Buffer.concat([Buffer.from([0x03]), Buffer.from(cborHex, "hex")]);
  return Buffer.from(sodium.crypto_generichash(28, tagged));
};

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

const fetchHandleDatumHex = async (handle, network, userAgent) => {
  const url = `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handle)}/datum`;
  const r = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "text/plain" },
  });
  if (!r.ok) throw new Error(`fetch datum ${handle}: HTTP ${r.status}`);
  const text = (await r.text()).trim();
  if (/^[0-9a-f]+$/i.test(text)) return text;
  try {
    const j = JSON.parse(text);
    return j.cbor ?? j.datum ?? text;
  } catch {
    return text;
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

  // 1. Compute new perspz hash from local plutus.json
  const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const perspz = blueprint.validators.find((v) => v.title === "perspz.perspz.withdraw");
  if (!perspz?.compiledCode) {
    throw new Error("perspz.perspz.withdraw missing from plutus.json — run aiken build first");
  }
  const newPerspzHash = await computeV3Hash(perspz.compiledCode);
  console.log(`new perspz hash to append: ${newPerspzHash.toString("hex")}`);

  // 2. Fetch current pz_settings datum
  console.log(`Fetching ${SETTINGS_HANDLE} datum from ${handlesApiBaseUrlForNetwork(network)}...`);
  const datumHex = await fetchHandleDatumHex(SETTINGS_HANDLE, network, userAgent);
  console.log(`current datum: ${datumHex.length / 2} bytes`);

  // 3. Decode, sanity-check shape, append new hash to valid_contracts (idx 4)
  const decoded = cbor.decodeFirstSync(Buffer.from(datumHex, "hex"));
  if (!Array.isArray(decoded) || decoded.length < 5) {
    throw new Error(`expected list datum with at least 5 elements; got ${decoded?.length ?? typeof decoded}`);
  }
  if (decoded.length === 9) {
    console.log("note: current datum is 9-elem (no persdsg_hashes) — append still safe");
  } else if (decoded.length === 10) {
    console.log("current datum is 10-elem (with persdsg_hashes) — preserving idx 9");
  } else {
    throw new Error(`unexpected datum element count: ${decoded.length}`);
  }
  const validContracts = decoded[4];
  if (!Array.isArray(validContracts)) {
    throw new Error("valid_contracts (idx 4) is not a list");
  }
  const existingHashes = validContracts.map((b) => Buffer.from(b).toString("hex"));
  if (existingHashes.includes(newPerspzHash.toString("hex"))) {
    console.log(`✓ new perspz hash already in valid_contracts (${existingHashes.length} entries); nothing to do`);
    return;
  }
  decoded[4] = [...validContracts, newPerspzHash];
  const patchedDatumHex = Buffer.from(cbor.encode(decoded)).toString("hex");
  console.log(`patched valid_contracts: ${existingHashes.length} -> ${decoded[4].length} entries (appended ${newPerspzHash.toString("hex")})`);

  // 4. Build settings-update tx
  console.log(`Building settings-update tx for ${SETTINGS_HANDLE} on ${network}...`);
  const built = await buildSettingsUpdateTx({
    network,
    settingsHandleName: SETTINGS_HANDLE,
    patchedDatumHex,
    nativeScriptCborHex: NATIVE_SCRIPT_BY_NETWORK[network],
    blockfrostApiKey,
    userAgent,
  });
  console.log(`  unsigned txId:        ${built.txId}`);
  console.log(`  estimated signed size: ${built.estimatedSignedTxSize}/${built.maxTxSize}`);

  // 5. Save unsigned cbor
  const outPath = `/tmp/addPerspz2Hash-${network}-unsigned.tx.cbor.hex`;
  writeFileSync(outPath, built.cborHex);
  console.log(`\n✓ Unsigned tx CBOR saved to ${outPath}`);
  console.log(`\n${SIGNER_INSTRUCTIONS[network]}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

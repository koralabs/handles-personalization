#!/usr/bin/env node
//
// Build an unsigned settings-update tx that adds the V3 contract hashes
// (pers_proxy + pers_logic) to pz_settings.valid_contracts. Pre-positions the
// chain so once the V3 ref-scripts deploy, pers_proxy.observer_withdrawal_is_valid
// and is_valid_contract checks both pass.
//
// What it does:
//   1. Reads plutus.json, computes blake2b-224(0x03 || cbor) for both
//      pers_proxy and pers_logic.
//   2. Fetches current pz_settings@handle_settings UTxO + datum.
//   3. Decodes the 9-element list datum, appends the two hashes to
//      valid_contracts (idx 4) — preserves all other fields' raw bytes.
//   4. Calls buildSettingsUpdateTx to produce an unsigned tx that re-spends
//      the pz_settings UTxO from the multisig native-script address back to
//      itself with the patched datum.
//   5. Saves the unsigned cbor to /tmp/addV3Hashes-<network>-unsigned.tx.cbor.hex
//      for the multisig signer(s) to add witnesses + submit.
//
// Usage:
//   node scripts/addV3HashesToValidContracts.js --network preview \
//        --blockfrost-api-key <key>  (or BLOCKFROST_API_KEY env)
//        [--policy-key <bech32 xprv>] (or POLICY_KEY env; only used to
//                                      produce a co-signed tx if the
//                                      deployer is one of the multisig
//                                      signers)
//
// The output CBOR is unsigned — the multisig (1-of-2 RequireAnyOf on preview)
// requires either signer to add a vkey witness. Hand off to whoever holds
// the multisig keys.

import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";

import cbor from "cbor";
import sodium from "libsodium-wrappers-sumo";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";

const SETTINGS_HANDLE = "pz_settings";

const PREVIEW_NATIVE_SCRIPT_CBOR_HEX =
  "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b" +
  "8200581cd9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d";

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
  const r = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!r.ok) throw new Error(`fetch datum ${handle}: HTTP ${r.status}`);
  // The endpoint returns either raw hex (text/plain) or a JSON envelope with
  // a `cbor` / `datum` field. Try JSON first, fall back to raw text.
  const text = await r.text();
  if (/^[0-9a-f]+$/i.test(text.trim())) return text.trim();
  try {
    const j = JSON.parse(text);
    return j.cbor ?? j.datum ?? text.trim();
  } catch {
    return text.trim();
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
  const network = args.network || "preview";
  if (network !== "preview") {
    throw new Error(`only preview is supported by this script; got ${network}`);
  }
  const minting = loadEnvFromFile("/home/jesse/src/koralabs/minting.handle.me/.env");
  const blockfrostApiKey =
    (args["blockfrost-api-key"] || minting.BLOCKFROST_API_KEY || process.env.BLOCKFROST_API_KEY || "").trim();
  if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY is required");
  const userAgent = "kora-cutover/1.0";

  // 1. Compute V3 hashes from plutus.json (canonical-slug per-variant split:
  //    persprx + perspz + perslfc + persdsg).
  const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const persProxy = blueprint.validators.find((v) => v.title === "persprx.persprx.spend");
  const persPz = blueprint.validators.find((v) => v.title === "perspz.perspz.withdraw");
  const persLfc = blueprint.validators.find((v) => v.title === "perslfc.perslfc.withdraw");
  const persDsg = blueprint.validators.find((v) => v.title === "persdsg.persdsg.withdraw");
  if (!persProxy || !persPz || !persLfc || !persDsg) {
    throw new Error("persprx / perspz / perslfc / persdsg missing from plutus.json — run aiken build first");
  }
  const persProxyHash = await computeV3Hash(persProxy.compiledCode);
  const persPzHash = await computeV3Hash(persPz.compiledCode);
  const persLfcHash = await computeV3Hash(persLfc.compiledCode);
  const persDsgHash = await computeV3Hash(persDsg.compiledCode);
  console.log(`persprx V3 hash : ${persProxyHash.toString("hex")}`);
  console.log(`perspz  V3 hash : ${persPzHash.toString("hex")}`);
  console.log(`perslfc V3 hash : ${persLfcHash.toString("hex")}`);
  console.log(`persdsg V3 hash : ${persDsgHash.toString("hex")}`);

  // 2. Fetch current pz_settings datum
  console.log(`Fetching ${SETTINGS_HANDLE} datum...`);
  const datumHex = await fetchHandleDatumHex(SETTINGS_HANDLE, network, userAgent);
  console.log(`current datum length: ${datumHex.length / 2} bytes`);

  // 3. Decode + patch valid_contracts (idx 4)
  const decoded = cbor.decodeFirstSync(Buffer.from(datumHex, "hex"));
  if (!Array.isArray(decoded) || decoded.length !== 9) {
    throw new Error(`expected 9-elem list datum (Helios shape), got ${decoded?.length ?? typeof decoded}`);
  }
  const validContracts = decoded[4];
  if (!Array.isArray(validContracts)) {
    throw new Error("valid_contracts (idx 4) is not a list");
  }
  const existingHashes = validContracts.map((b) => Buffer.from(b).toString("hex"));
  const wantedHashes = [
    { name: "persprx", buf: persProxyHash },
    { name: "perspz", buf: persPzHash },
    { name: "perslfc", buf: persLfcHash },
    { name: "persdsg", buf: persDsgHash },
  ];
  const toAdd = wantedHashes
    .filter(({ buf }) => !existingHashes.includes(buf.toString("hex")))
    .map(({ buf }) => buf);
  if (toAdd.length === 0) {
    console.log("✓ all four V3 hashes already in valid_contracts; nothing to do");
    return;
  }
  decoded[4] = [...validContracts, ...toAdd];
  const patchedDatumHex = Buffer.from(cbor.encode(decoded)).toString("hex");
  console.log(`patched valid_contracts: ${existingHashes.length} -> ${decoded[4].length} entries`);
  console.log(`  added:`);
  for (const h of toAdd) console.log(`    ${h.toString("hex")}`);

  // 4. Build settings-update tx
  console.log(`Building settings-update tx for ${SETTINGS_HANDLE}...`);
  const built = await buildSettingsUpdateTx({
    network,
    settingsHandleName: SETTINGS_HANDLE,
    patchedDatumHex,
    nativeScriptCborHex: PREVIEW_NATIVE_SCRIPT_CBOR_HEX,
    blockfrostApiKey,
    userAgent,
  });
  console.log(`  unsigned txId:        ${built.txId}`);
  console.log(`  estimated signed size: ${built.estimatedSignedTxSize}/${built.maxTxSize}`);

  // 5. Save unsigned cbor for multisig signing
  const outPath = `/tmp/addV3Hashes-${network}-unsigned.tx.cbor.hex`;
  writeFileSync(outPath, built.cborHex);
  console.log(`\n✓ Unsigned tx CBOR saved to ${outPath}`);
  console.log(
    `\nMultisig (1-of-2 RequireAnyOf) signers on preview:\n` +
      `  5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b\n` +
      `  d9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d\n` +
      `\nEither key adds a vkey witness, then submit.`
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
//
// Build an unsigned multisig settings-update tx that simultaneously:
//
//   1. Adds the three new V3 contract hashes (perspz, perslfc, persdsg
//      — persprx is hash-stable and stays at 7cf10558...) to
//      `pz_settings.valid_contracts` (list at idx 4).
//
//   2. Appends a 10th list element `persdsg_hashes` containing the new
//      persdsg hash. This is the new Phase-1 field perspz reads at
//      runtime instead of hardcoding the persdsg hash. After this
//      update lands, future persdsg redeploys can be approved by just
//      appending to this list — no perspz rebuild required.
//
// Backward compat: settings was 9-elem; perspz on chain expects 9-elem
// (strict). After this update, settings is 10-elem; the OLD perspz
// (192e06be) will refuse to parse it. Sequence the deploy:
//
//   a. Run scripts/deployContractRefScripts.js first to redeploy
//      perspz/perslfc/persdsg ref-scripts. This makes the NEW perspz
//      (7c99516a) available to the BFF via /scripts.
//   b. Run THIS script to produce the unsigned multisig settings tx.
//   c. Multisig signs + submits. At that moment OLD perspz becomes
//      unusable (10-elem settings), but BFF is already on NEW perspz.
//
// Usage:
//   node scripts/addPersdsgHashesAndV3HashesToSettings.js --network preview \
//        --blockfrost-api-key <key>     (or BLOCKFROST_API_KEY env)
//
// Output:
//   /tmp/addPersdsgHashes-preview-unsigned.tx.cbor.hex
// + multisig signer instructions printed to stdout.
//

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

  // 1. Compute V3 hashes from plutus.json
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

  // 3. Decode + patch valid_contracts (idx 4) AND append persdsg_hashes (idx 9)
  const decoded = cbor.decodeFirstSync(Buffer.from(datumHex, "hex"));
  if (!Array.isArray(decoded)) {
    throw new Error(`expected list datum, got ${typeof decoded}`);
  }
  if (decoded.length !== 9 && decoded.length !== 10) {
    throw new Error(`expected 9- or 10-elem list datum, got ${decoded.length}`);
  }
  const validContracts = decoded[4];
  if (!Array.isArray(validContracts)) {
    throw new Error("valid_contracts (idx 4) is not a list");
  }

  const existingHashes = validContracts.map((b) => Buffer.from(b).toString("hex"));
  const wantedV3Hashes = [
    { name: "persprx", buf: persProxyHash },
    { name: "perspz", buf: persPzHash },
    { name: "perslfc", buf: persLfcHash },
    { name: "persdsg", buf: persDsgHash },
  ];
  const toAdd = wantedV3Hashes
    .filter(({ buf }) => !existingHashes.includes(buf.toString("hex")))
    .map(({ buf, name }) => ({ name, buf }));
  if (toAdd.length > 0) {
    decoded[4] = [...validContracts, ...toAdd.map((x) => x.buf)];
    console.log(`patched valid_contracts: ${existingHashes.length} -> ${decoded[4].length} entries`);
    console.log(`  added:`);
    for (const { name, buf } of toAdd) console.log(`    ${name}: ${buf.toString("hex")}`);
  } else {
    console.log(`✓ all four V3 hashes already in valid_contracts`);
  }

  // 4. Append/update persdsg_hashes (idx 9). The new perspz reads this list
  //    at runtime to decide which withdrawal observers count as "persdsg"
  //    (instead of comparing against a hardcoded constant). Keep both the
  //    deployed-prior persdsg hash AND the new one in the list so any
  //    in-flight tx still using the old perspz/persdsg path also resolves.
  const desiredPersdsgHashes = [];
  // Currently-deployed persdsg (resolved from api /scripts).
  const currentDeployedPersdsg = "6627fa362e816cc3a8e941cdcc86a753de1434bae2b7e149011bb25b";
  if (!desiredPersdsgHashes.find((b) => b.toString("hex") === currentDeployedPersdsg)) {
    desiredPersdsgHashes.push(Buffer.from(currentDeployedPersdsg, "hex"));
  }
  // New persdsg from this build.
  if (!desiredPersdsgHashes.find((b) => b.toString("hex") === persDsgHash.toString("hex"))) {
    desiredPersdsgHashes.push(persDsgHash);
  }

  if (decoded.length === 9) {
    decoded.push(desiredPersdsgHashes);
    console.log(`appended persdsg_hashes (idx 9): ${desiredPersdsgHashes.length} entries`);
  } else {
    // Already 10-elem — merge in any missing hashes.
    const existing = decoded[9];
    if (!Array.isArray(existing)) {
      throw new Error("idx 9 (persdsg_hashes) exists but is not a list");
    }
    const existingSet = new Set(existing.map((b) => Buffer.from(b).toString("hex")));
    const merged = [...existing];
    for (const h of desiredPersdsgHashes) {
      if (!existingSet.has(h.toString("hex"))) merged.push(h);
    }
    decoded[9] = merged;
    console.log(`merged persdsg_hashes: ${existing.length} -> ${merged.length} entries`);
  }
  for (const h of desiredPersdsgHashes) console.log(`    ${h.toString("hex")}`);

  if (toAdd.length === 0 && decoded.length === 9) {
    // No-op: nothing changed. (Should never hit since we always append idx 9 when length==9, but defensive.)
    console.log("nothing to update");
    return;
  }

  const patchedDatumHex = Buffer.from(cbor.encode(decoded)).toString("hex");

  // 5. Build settings-update tx
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

  // 6. Save unsigned cbor for multisig signing
  const outPath = `/tmp/addPersdsgHashes-${network}-unsigned.tx.cbor.hex`;
  writeFileSync(outPath, built.cborHex);
  console.log(`\n✓ Unsigned tx CBOR saved to ${outPath}`);
  console.log(
    `\nMultisig (1-of-2 RequireAnyOf) signers on preview:\n` +
      `  5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b\n` +
      `  d9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d\n` +
      `\nEither key adds a vkey witness, then submit.`
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// Build the ordered, unsigned multisig transaction chain that moves V3
// personalization from the legacy settings handles to the canonical pers*
// namespace. This script never signs or submits.

import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import cbor from "cbor";
import sodium from "libsodium-wrappers-sumo";

import { buildSettingsUpdateTx } from "../settingsUpdateTx.js";

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

export const LEGACY_PROXY_MIGRATION_HASH = Buffer.from(
  "7cf105586f77934a524c9e78f8879a33460104f9578e9ac927f577e3",
  "hex",
);

export const referenceHandleWitnessConfig = (network) =>
  network === "mainnet"
    ? { includeNativeScriptWitness: true, vkeyWitnessCount: 2 }
    : { includeNativeScriptWitness: false, vkeyWitnessCount: 1 };

const CONTRACTS = [
  { slug: "perspz", handle: "perspz1@handlecontract", title: "perspz.perspz.withdraw" },
  { slug: "perslfc", handle: "perslfc1@handlecontract", title: "perslfc.perslfc.withdraw" },
  { slug: "persprx", handle: "persprx1@handlecontract", title: "persprx.persprx.spend" },
];

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    args[argv[i].slice(2)] = argv[++i];
  }
  return args;
};

const apiBase = (network) =>
  network === "mainnet" ? "https://api.handle.me" : `https://${network}.api.handle.me`;

const fetchDatumHex = async (network, handle) => {
  const response = await fetch(`${apiBase(network)}/handles/${encodeURIComponent(handle)}/datum`, {
    headers: { Accept: "text/plain", "User-Agent": "kora-namespace-cutover/1.0" },
  });
  if (!response.ok) throw new Error(`${network} ${handle} datum: HTTP ${response.status}`);
  const datumHex = (await response.text()).trim();
  if (!/^[0-9a-f]+$/i.test(datumHex)) throw new Error(`${network} ${handle}: datum is not CBOR hex`);
  return datumHex;
};

const hashValidator = async (validator) => {
  await sodium.ready;
  return Buffer.from(
    sodium.crypto_generichash(
      28,
      Buffer.concat([Buffer.from([3]), Buffer.from(validator.compiledCode, "hex")]),
    ),
  );
};

export const patchSettings = (datumHex, contractHashes, persdsgHash) => {
  const fields = cbor.decodeFirstSync(Buffer.from(datumHex, "hex"));
  if (!Array.isArray(fields) || (fields.length !== 9 && fields.length !== 10)) {
    throw new Error(`settings datum must be a 9- or 10-element list, got ${fields?.length}`);
  }
  if (!Array.isArray(fields[4])) throw new Error("settings valid_contracts must be a list");
  const existing = new Set(fields[4].map((value) => Buffer.from(value).toString("hex")));
  for (const hash of contractHashes) {
    if (!existing.has(hash.toString("hex"))) fields[4].push(hash);
  }
  if (fields.length === 9) fields.push([]);
  if (!Array.isArray(fields[9])) throw new Error("settings persdsg_hashes must be a list");
  const existingPersdsg = new Set(fields[9].map((value) => Buffer.from(value).toString("hex")));
  if (!existingPersdsg.has(persdsgHash.toString("hex"))) fields[9].push(persdsgHash);
  return Buffer.from(cbor.encode(fields)).toString("hex");
};

const fetchInputRefScriptBytes = async (network, apiKey, handle) => {
  const handleResponse = await fetch(`${apiBase(network)}/handles/${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": "kora-namespace-cutover/1.0" },
  });
  if (!handleResponse.ok) throw new Error(`${network} ${handle}: HTTP ${handleResponse.status}`);
  const [txId, indexText] = (await handleResponse.json()).utxo.split("#");
  const utxoResponse = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/txs/${txId}/utxos`, {
    headers: { project_id: apiKey },
  });
  if (!utxoResponse.ok) throw new Error(`${network} ${handle} UTxO: HTTP ${utxoResponse.status}`);
  const output = (await utxoResponse.json()).outputs.find(
    (candidate) => candidate.output_index === Number(indexText),
  );
  if (!output?.reference_script_hash) return 0;
  const scriptResponse = await fetch(
    `https://cardano-${network}.blockfrost.io/api/v0/scripts/${output.reference_script_hash}/cbor`,
    { headers: { project_id: apiKey } },
  );
  if (!scriptResponse.ok) throw new Error(`${network} old ${handle} script: HTTP ${scriptResponse.status}`);
  return (await scriptResponse.json()).cbor.length / 2;
};

const writeArtifact = (outDir, number, name, description, built) => {
  const base = `${String(number).padStart(2, "0")}-${name}`;
  writeFileSync(path.join(outDir, `${base}.cbor.hex`), built.cborHex);
  writeFileSync(
    path.join(outDir, `${base}.eternl.json`),
    `${JSON.stringify({ type: "Tx ConwayEra", description, cborHex: built.cborHex }, null, 2)}\n`,
  );
  return {
    order: number,
    name,
    description,
    txId: built.txId,
    estimatedSignedTxSize: built.estimatedSignedTxSize,
    consumedInputs: [...built.consumedInputs],
    handleUtxoRef: built.handleUtxoRef,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = args.network;
  const apiKey = args["blockfrost-api-key"] || process.env.BLOCKFROST_API_KEY;
  const outDir = args["out-dir"];
  const referenceScriptsOnly = args["reference-scripts-only"] === "true";
  if (!NATIVE_SCRIPT_BY_NETWORK[network] || !apiKey || !outDir) {
    throw new Error("usage: --network preview|preprod|mainnet --out-dir <dir> --blockfrost-api-key <key>");
  }
  mkdirSync(outDir, { recursive: true });

  const blueprint = JSON.parse(readFileSync(new URL("../aiken/plutus.json", import.meta.url), "utf8"));
  const validators = Object.fromEntries(
    await Promise.all(
      ["persprx", "perspz", "perslfc", "persdsg"].map(async (slug) => {
        const validator = blueprint.validators.find((entry) => entry.title.startsWith(`${slug}.${slug}.`));
        if (!validator?.compiledCode) throw new Error(`missing ${slug} validator in aiken/plutus.json`);
        return [slug, { ...validator, hashBytes: await hashValidator(validator) }];
      }),
    ),
  );
  const hashes = Object.fromEntries(Object.entries(validators).map(([slug, value]) => [slug, value.hashBytes.toString("hex")]));

  let projectedChange = null;
  const consumed = new Set();
  const manifest = {
    network,
    generatedAt: new Date().toISOString(),
    mode: referenceScriptsOnly ? "reference-scripts-only" : "full",
    hashes,
    transactions: [],
  };
  const buildStep = async ({
    number,
    name,
    description,
    handle,
    datumHex,
    scriptReference,
    inputRefScriptBytes = 0,
    includeNativeScriptWitness = true,
    vkeyWitnessCount = 2,
  }) => {
    const built = await buildSettingsUpdateTx({
      network,
      settingsHandleName: handle,
      patchedDatumHex: datumHex,
      nativeScriptCborHex: NATIVE_SCRIPT_BY_NETWORK[network],
      blockfrostApiKey: apiKey,
      userAgent: "kora-namespace-cutover/1.0",
      additionalPreSelectedUtxos: projectedChange ? [projectedChange] : [],
      excludeFromRemainingUtxos: [...consumed],
      scriptReference,
      inputRefScriptBytes,
      includeNativeScriptWitness,
      vkeyWitnessCount,
    });
    for (const input of built.consumedInputs) consumed.add(input);
    projectedChange = built.changeUtxo;
    if (!projectedChange) throw new Error(`${name}: transaction has no projected ADA-only change output`);
    manifest.transactions.push(writeArtifact(outDir, number, name, description, built));
  };

  if (!referenceScriptsOnly) {
    // Both settings authorities must authorize the frozen old proxy while
    // LBL_100 outputs remain there. The old proxy consults legacy pz_settings,
    // while the current perslfc migration observer consults canonical settings
    // and requires the source validator hash to be authorized too.
    const migrationContractHashes = [
      ...Object.values(validators).map((value) => value.hashBytes),
      LEGACY_PROXY_MIGRATION_HASH,
    ];
    const canonicalSettings = patchSettings(
      await fetchDatumHex(network, "pers@handle_settings"),
      migrationContractHashes,
      validators.persdsg.hashBytes,
    );
    const legacyBridgeSettings = patchSettings(
      await fetchDatumHex(network, "pz_settings"),
      migrationContractHashes,
      validators.persdsg.hashBytes,
    );
    const canonicalBgRoot = await fetchDatumHex(network, "bg_policy_ids");
    const canonicalPfpRoot = await fetchDatumHex(network, "pfp_policy_ids");

    await buildStep({ number: 1, name: "canonical-settings", description: "Activate canonical pers@handle_settings for namespaced V3 contracts", handle: "pers@handle_settings", datumHex: canonicalSettings });
    await buildStep({ number: 2, name: "canonical-bg-root", description: "Copy the live authorized BG MPF root to pers_bg@handle_settings", handle: "pers_bg@handle_settings", datumHex: canonicalBgRoot });
    await buildStep({ number: 3, name: "canonical-pfp-root", description: "Copy the live authorized PFP root to pers_pfp@handle_settings", handle: "pers_pfp@handle_settings", datumHex: canonicalPfpRoot });
    await buildStep({ number: 4, name: "legacy-migration-bridge", description: "Authorize the namespaced V3 contracts in legacy pz_settings solely for migration of old proxy UTxOs", handle: "pz_settings", datumHex: legacyBridgeSettings });

    // Reference-handle authority differs by network. Preview/preprod were moved
    // to derivation 12 during rehearsal; mainnet's existing reference handles
    // remain at the settings native-script address. Never carry transaction 04's
    // change across the authority boundary on the test networks.
    projectedChange = null;
  }

  let number = 5;
  for (const contract of CONTRACTS) {
    const validator = validators[contract.slug];
    await buildStep({
      number,
      name: `${contract.slug}-reference-script`,
      description: `Deploy namespaced ${contract.slug} reference script (${hashes[contract.slug]})`,
      handle: contract.handle,
      scriptReference: { __type: "plutus", bytes: validator.compiledCode, version: 2 },
      inputRefScriptBytes: await fetchInputRefScriptBytes(network, apiKey, contract.handle),
      ...referenceHandleWitnessConfig(network),
    });
    number += 1;
  }

  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

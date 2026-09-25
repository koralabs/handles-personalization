#!/usr/bin/env node
// Build ONE unsigned personalization reference-script deployment at the handlecontract
// multisig address (mainnet 2-of-4 by default; --network preview|preprod for testnets). No signing or submission. Run sequentially after
// the preceding deployment confirms so the clean funding change is current.
import { readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import sodium from 'libsodium-wrappers-sumo';
import { buildSettingsUpdateTx } from '../settingsUpdateTx.js';

const CONTRACTS = {
  persdsg: { handle: 'persdsg1@handlecontract', title: 'persdsg.persdsg.withdraw' },
  perspz: { handle: 'perspz1@handlecontract', title: 'perspz.perspz.withdraw' },
  perslfc: { handle: 'perslfc1@handlecontract', title: 'perslfc.perslfc.withdraw' },
  persprx: { handle: 'persprx1@handlecontract', title: 'persprx.persprx.spend' }
};
// --handle <x@handlecontract> --script-hash <hex>: attach an EXISTING on-chain PlutusV3 script (exact
// ledger bytes fetched by hash, re-hashed and checked) to any contract handle — used to re-register
// an earlier version (mainnet persprx repair: persprx2 <- 7a04600f…, persprx1 <- 7cf105…).
const args = Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
const slug = args.contract;
const fromChain = Boolean(args['script-hash']);
if (fromChain ? !args.handle : !CONTRACTS[slug]) {
  throw new Error('usage: --contract persdsg|perspz|perslfc|persprx | --handle <handle> --script-hash <hex>; plus --native-script-cbor-file <path> [--network mainnet|preprod|preview] [--out <path>]');
}
const network = args.network || 'mainnet';
if (!['mainnet', 'preprod', 'preview'].includes(network)) throw new Error(`unknown --network ${network}`);
const blockfrostBase = `https://cardano-${network}.blockfrost.io/api/v0`;
const handlesApiBase = network === 'mainnet' ? 'https://api.handle.me' : `https://${network}.api.handle.me`;
const key = process.env.BLOCKFROST_API_KEY;
if (!key) throw new Error('BLOCKFROST_API_KEY required');
const nativeScriptCborHex = readFileSync(args['native-script-cbor-file'], 'utf8').trim();
await sodium.ready;
// Script hash = blake2b-224(language tag || bytes); tag 2 = PlutusV2, 3 = PlutusV3.
const LANGUAGE_TAG = { plutusV2: 2, plutusV3: 3 };
const scriptHash = (hex, tag) => Buffer.from(sodium.crypto_generichash(28, Buffer.concat([Buffer.from([tag]), Buffer.from(hex, 'hex')]))).toString('hex');
let languageTag = LANGUAGE_TAG.plutusV3;
let compiledCode;
if (fromChain) {
  const response = await fetch(`${blockfrostBase}/scripts/${args['script-hash']}/cbor`, { headers: { project_id: key } });
  if (!response.ok) throw new Error(`script ${args['script-hash']} lookup failed: HTTP ${response.status}`);
  compiledCode = (await response.json()).cbor;
  const infoResponse = await fetch(`${blockfrostBase}/scripts/${args['script-hash']}`, { headers: { project_id: key } });
  if (!infoResponse.ok) throw new Error(`script ${args['script-hash']} info lookup failed: HTTP ${infoResponse.status}`);
  const { type } = await infoResponse.json();
  languageTag = LANGUAGE_TAG[type];
  if (!languageTag) throw new Error(`unsupported script type ${type}`);
  if (scriptHash(compiledCode, languageTag) !== args['script-hash']) {
    throw new Error(`fetched ${type} bytes hash to ${scriptHash(compiledCode, languageTag)}, not ${args['script-hash']}; refusing`);
  }
} else {
  const blueprint = JSON.parse(readFileSync(new URL('../aiken/plutus.json', import.meta.url), 'utf8'));
  const validator = blueprint.validators.find((v) => v.title === CONTRACTS[slug].title);
  if (!validator?.compiledCode) throw new Error(`compiled validator missing: ${CONTRACTS[slug].title}`);
  compiledCode = validator.compiledCode;
}
const handleName = fromChain ? args.handle : CONTRACTS[slug].handle;
const expectedHash = scriptHash(compiledCode, languageTag);
// cardano-sdk PlutusLanguageVersion: V1=0, V2=1, V3=2 (language tag - 1).
const scriptReference = { __type: 'plutus', bytes: compiledCode, version: languageTag - 1 };

const handleResponse = await fetch(
  `${handlesApiBase}/handles/${encodeURIComponent(handleName)}`,
  { headers: { 'User-Agent': process.env.KORA_USER_AGENT || 'kora-contract-deployments/1.0' } }
);
if (!handleResponse.ok) throw new Error(`handle lookup failed: HTTP ${handleResponse.status}`);
const [currentTxId, currentIndexText] = (await handleResponse.json()).utxo.split('#');
const currentUtxoResponse = await fetch(
  `${blockfrostBase}/txs/${currentTxId}/utxos`,
  { headers: { project_id: key } }
);
if (!currentUtxoResponse.ok) throw new Error(`current UTxO lookup failed: HTTP ${currentUtxoResponse.status}`);
const currentOutput = (await currentUtxoResponse.json()).outputs.find(
  (output) => output.output_index === Number(currentIndexText)
);
let inputRefScriptBytes = 0;
if (currentOutput?.reference_script_hash) {
  const oldScriptResponse = await fetch(
    `${blockfrostBase}/scripts/${currentOutput.reference_script_hash}/cbor`,
    { headers: { project_id: key } }
  );
  if (!oldScriptResponse.ok) throw new Error(`old ref-script lookup failed: HTTP ${oldScriptResponse.status}`);
  inputRefScriptBytes = (await oldScriptResponse.json()).cbor.length / 2;
}

const built = await buildSettingsUpdateTx({
  network,
  settingsHandleName: handleName,
  nativeScriptCborHex,
  blockfrostApiKey: key,
  userAgent: process.env.KORA_USER_AGENT || 'kora-contract-deployments/1.0',
  scriptReference,
  inputRefScriptBytes,
  patchedDatumHex: undefined
});
const out = args.out || `/tmp/${(slug ?? handleName).replace(/@.*/, '')}-${network}-ref-unsigned.cbor.hex`;
writeFileSync(out, built.cborHex);
console.log(JSON.stringify({ slug, handle: handleName, expectedHash, txId: built.txId, estimatedSignedTxSize: built.estimatedSignedTxSize, consumedInputs: [...built.consumedInputs], out }, null, 2));

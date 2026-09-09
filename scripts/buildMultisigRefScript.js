#!/usr/bin/env node
// Build ONE unsigned personalization reference-script deployment at the mainnet
// 2-of-4 handlecontract address. No signing or submission. Run sequentially after
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
const args = Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
const slug = args.contract;
if (!CONTRACTS[slug]) throw new Error('usage: --contract persdsg|perspz|perslfc|persprx --native-script-cbor-file <path> [--out <path>]');
const key = process.env.BLOCKFROST_API_KEY;
if (!key) throw new Error('BLOCKFROST_API_KEY required');
const nativeScriptCborHex = readFileSync(args['native-script-cbor-file'], 'utf8').trim();
const blueprint = JSON.parse(readFileSync(new URL('../aiken/plutus.json', import.meta.url), 'utf8'));
const validator = blueprint.validators.find((v) => v.title === CONTRACTS[slug].title);
if (!validator?.compiledCode) throw new Error(`compiled validator missing: ${CONTRACTS[slug].title}`);
await sodium.ready;
const expectedHash = Buffer.from(sodium.crypto_generichash(28, Buffer.concat([Buffer.from([3]), Buffer.from(validator.compiledCode, 'hex')]))).toString('hex');
const scriptReference = { __type: 'plutus', bytes: validator.compiledCode, version: 2 };
const built = await buildSettingsUpdateTx({
  network: 'mainnet',
  settingsHandleName: CONTRACTS[slug].handle,
  nativeScriptCborHex,
  blockfrostApiKey: key,
  userAgent: process.env.KORA_USER_AGENT || 'kora-contract-deployments/1.0',
  scriptReference,
  patchedDatumHex: undefined
});
const out = args.out || `/tmp/${slug}-mainnet-ref-unsigned.cbor.hex`;
writeFileSync(out, built.cborHex);
console.log(JSON.stringify({ slug, handle: CONTRACTS[slug].handle, expectedHash, txId: built.txId, estimatedSignedTxSize: built.estimatedSignedTxSize, consumedInputs: [...built.consumedInputs], out }, null, 2));

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const CSL = require(path.join(WORKSPACE_ROOT, 'minting.handle.me/node_modules/@emurgo/cardano-serialization-lib-nodejs'));

const OUT = path.join(REPO_ROOT, 'tasks/tmp/mainnet-historical-personalization/artifacts');
const INVENTORY_PATH = path.join(REPO_ROOT, 'tasks/tmp/mainnet-contract-handle-report/personalization-family-inventory.json');
const EXISTING_PROTOCOL_PARAMS = path.join(WORKSPACE_ROOT, 'adahandle-deployments/tasks/tmp/mainnet-contract-migration/artifacts/cli-protocol-params.json');
const API_BASE = 'https://api.handle.me';
const KOIOS_BASE = 'https://api.koios.rest/api/v1';
const POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const FUNDING_SOURCE_REF = '87f90d96e7625ecfd388374f725e9f696120e0cfcc150aae365b8866168e48ed#15';
const FUNDING_FANOUT_FEE = 2500000n;
const HANDLE_REFRESH_FEE = 1200000n;
const SCRIPT_OUTPUT_BUFFER = 500000n;
const WITNESS_PATH = path.join(WORKSPACE_ROOT, 'adahandle-deployments/tasks/tmp/mainnet-contract-migration/mainnet-wallet-payment-native-script.json');

function loadUserAgent() {
  for (const envPath of [
    path.join(REPO_ROOT, '.env.local'),
    path.join(REPO_ROOT, '.env'),
    path.join(WORKSPACE_ROOT, 'kora-bot/.env.local'),
    path.join(WORKSPACE_ROOT, 'kora-bot/.env'),
  ]) {
    if (!fs.existsSync(envPath)) continue;
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((row) => row.startsWith('KORA_USER_AGENT='));
    if (line) return line.split('=', 2)[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error('KORA_USER_AGENT missing from repo env files');
}

async function fetchJson(url, userAgent, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': userAgent,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`fetch ${url} -> ${response.status}`);
  }
  return await response.json();
}

async function fetchText(url, userAgent) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetch ${url} -> ${response.status}`);
  return (await response.text()).trim();
}

async function fetchHandle(handle, userAgent) {
  return await fetchJson(`${API_BASE}/handles/${encodeURIComponent(handle)}`, userAgent);
}

async function fetchTxOutputs(txHashes, userAgent) {
  return await fetchJson(`${KOIOS_BASE}/tx_utxos`, userAgent, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _tx_hashes: txHashes }),
  });
}

async function fetchOutput(txin, userAgent) {
  const [txHash, index] = txin.split('#');
  const rows = await fetchTxOutputs([txHash], userAgent);
  const row = rows[0];
  if (!row) throw new Error(`missing tx ${txHash}`);
  const output = row.outputs.find((entry) => String(entry.tx_index ?? entry.output_index) === String(index));
  if (!output) throw new Error(`missing output ${txin}`);
  return output;
}

function readWitnessHexes() {
  const payload = JSON.parse(fs.readFileSync(WITNESS_PATH, 'utf8'));
  return Array.isArray(payload) ? payload : [payload.native_script_cbor_hex].filter(Boolean);
}

function stringifyJson(payload) {
  return JSON.stringify(payload, (_, value) => (typeof value === 'bigint' ? String(value) : value), 2);
}

function txidFor(txbodyPath) {
  return JSON.parse(
    execFileSync('cardano-cli', ['conway', 'transaction', 'txid', '--tx-body-file', txbodyPath, '--output-json'], { encoding: 'utf8' })
  ).txhash;
}

function loadBodyFromTxbody(txbodyPath) {
  const txbody = JSON.parse(fs.readFileSync(txbodyPath, 'utf8'));
  const raw = Buffer.from(txbody.cborHex, 'hex');
  try {
    return CSL.TransactionBody.from_bytes(raw);
  } catch (_) {
    return CSL.Transaction.from_bytes(raw).body();
  }
}

function estimateSignedSize(tx, vkeyCount) {
  const witnessSet = tx.witness_set();
  const vkeys = CSL.Vkeywitnesses.new();
  for (let i = 0; i < vkeyCount; i += 1) {
    const seed = i + 1;
    const pubkey = CSL.PublicKey.from_bytes(Buffer.alloc(32, seed));
    const signature = CSL.Ed25519Signature.from_bytes(Buffer.alloc(64, seed));
    vkeys.add(CSL.Vkeywitness.new(CSL.Vkey.new(pubkey), signature));
  }
  witnessSet.set_vkeys(vkeys);
  return CSL.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data()).to_bytes().length;
}

function buildFullTx(txbodyPath, witnessHexes, outPath) {
  const body = loadBodyFromTxbody(txbodyPath);
  const witnessSet = CSL.TransactionWitnessSet.new();
  if (witnessHexes.length > 0) {
    const nativeScripts = CSL.NativeScripts.new();
    for (const hex of witnessHexes) {
      nativeScripts.add(CSL.NativeScript.from_bytes(Buffer.from(hex, 'hex')));
    }
    witnessSet.set_native_scripts(nativeScripts);
  }
  const tx = CSL.Transaction.new(body, witnessSet, undefined);
  const bytes = Buffer.from(tx.to_bytes());
  fs.writeFileSync(outPath, bytes);
  fs.writeFileSync(`${outPath}.hex`, `${bytes.toString('hex')}\n`);
  return {
    bytes: bytes.length,
    native_script_count: witnessHexes.length,
    estimated_size_with_2_vkeys: estimateSignedSize(tx, 2),
    estimated_size_with_3_vkeys: estimateSignedSize(tx, 3),
  };
}

function assetUnitFor(handle) {
  return `${POLICY}.000de140${Buffer.from(handle, 'utf8').toString('hex')}`;
}

function parseCoin(output) {
  const match = String(output).match(/([0-9]+)/);
  if (!match) throw new Error(`unable to parse coin from ${output}`);
  return BigInt(match[1]);
}

function cliScriptJson(cborHex, description) {
  return JSON.stringify({
    type: 'PlutusScriptV2',
    description,
    cborHex,
  }, null, 2);
}

async function calculateMinRequiredUtxo({ protocolParamsPath, address, handle, datumBytes, scriptCborHex, workDir }) {
  const scriptPath = path.join(workDir, 'source.reference-script-v2.json');
  fs.writeFileSync(scriptPath, cliScriptJson(scriptCborHex, `${handle}-historical-refresh`));

  const args = [
    'conway',
    'transaction',
    'calculate-min-required-utxo',
    '--protocol-params-file',
    protocolParamsPath,
    '--tx-out',
    `${address}+1 ${assetUnitFor(handle)}`,
    '--tx-out-reference-script-file',
    scriptPath,
  ];

  let datumPath = null;
  if (datumBytes) {
    datumPath = path.join(workDir, 'source.inline-datum.cbor');
    fs.writeFileSync(datumPath, datumBytes);
    args.push('--tx-out-inline-datum-cbor-file', datumPath);
  }

  const raw = execFileSync('cardano-cli', args, { encoding: 'utf8' }).trim();
  return {
    minLovelace: parseCoin(raw),
    scriptPath,
    datumPath,
  };
}

async function buildFundingFanout({ plan, protocolParamsPath, userAgent, witnessHexes }) {
  const sourceOutput = await fetchOutput(FUNDING_SOURCE_REF, userAgent);
  const fundingSourceLovelace = BigInt(sourceOutput.value);
  const fundingOutputs = plan.map((item) => item.required_funding);
  const totalOutputs = fundingOutputs.reduce((sum, value) => sum + value, 0n);
  const changeLovelace = fundingSourceLovelace - totalOutputs - FUNDING_FANOUT_FEE;
  if (changeLovelace <= 0n) {
    throw new Error('funding source does not cover historical personalization fanout');
  }

  const dir = path.join(OUT, '00-funding-fanout');
  fs.mkdirSync(dir, { recursive: true });
  const txbodyPath = path.join(dir, 'txbody.json');
  const args = [
    'conway',
    'transaction',
    'build-raw',
    '--tx-in',
    FUNDING_SOURCE_REF,
  ];
  for (const item of plan) {
    args.push('--tx-out', `${item.address}+${item.required_funding}`);
  }
  args.push('--tx-out', `${plan[0].address}+${changeLovelace}`, '--fee', String(FUNDING_FANOUT_FEE), '--out-file', txbodyPath);
  execFileSync('cardano-cli', args, { stdio: 'inherit' });
  const txid = txidFor(txbodyPath);
  const cborPath = path.join(dir, 'tx.cbor');
  const built = buildFullTx(txbodyPath, witnessHexes, cborPath);
  const summary = {
    order: 0,
    kind: 'funding_fanout',
    funding_source_ref: FUNDING_SOURCE_REF,
    funding_source_lovelace: String(fundingSourceLovelace),
    fee: String(FUNDING_FANOUT_FEE),
    change_ref: `${txid}#${plan.length}`,
    change_lovelace: String(changeLovelace),
    outputs: plan.map((item, index) => ({
      purpose: item.target_handle,
      ref: `${txid}#${index}`,
      lovelace: String(item.required_funding),
    })),
    txid,
    txbody: txbodyPath,
    cbor: cborPath,
    cbor_hex: `${cborPath}.hex`,
    native_script_count: built.native_script_count,
    full_tx_bytes: built.bytes,
    estimated_size_with_2_vkeys: built.estimated_size_with_2_vkeys,
    estimated_size_with_3_vkeys: built.estimated_size_with_3_vkeys,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return { txid, summary };
}

async function buildHistoricalRefresh(item, context) {
  const { protocolParamsPath, userAgent, witnessHexes, fundingRef, fundingAmount } = context;
  const dir = path.join(OUT, `${item.order.toString().padStart(2, '0')}-${item.slug}`);
  fs.mkdirSync(dir, { recursive: true });

  const targetRecord = await fetchHandle(item.target_handle, userAgent);
  const targetOutput = await fetchOutput(targetRecord.utxo, userAgent);
  const sourceScriptCbor = item.source_row.script_cbor || (await fetchJson(`${API_BASE}/handles/${encodeURIComponent(item.source_handle)}/script`, userAgent)).cbor;
  const sourceDatumHex = item.source_row.datum_cbor || (await fetchText(`${API_BASE}/handles/${encodeURIComponent(item.source_handle)}/datum`, userAgent));
  const datumBytes = sourceDatumHex ? Buffer.from(sourceDatumHex, 'hex') : null;

  const { minLovelace, scriptPath, datumPath } = await calculateMinRequiredUtxo({
    protocolParamsPath,
    address: item.address,
    handle: item.target_handle,
    datumBytes,
    scriptCborHex: sourceScriptCbor,
    workDir: dir,
  });
    const desiredLovelace = minLovelace + SCRIPT_OUTPUT_BUFFER;
    const targetLovelace = BigInt(targetOutput.value);
    const outputLovelace = targetLovelace > desiredLovelace ? targetLovelace : desiredLovelace;
    const computedFunding = outputLovelace + HANDLE_REFRESH_FEE - targetLovelace;
    if (computedFunding !== fundingAmount) {
      throw new Error(`${item.target_handle} funding mismatch: planned ${fundingAmount}, computed ${computedFunding}`);
    }

  const txbodyPath = path.join(dir, 'txbody.json');
  const args = [
    'conway',
    'transaction',
    'build-raw',
    '--tx-in',
    targetRecord.utxo,
    '--tx-in',
    fundingRef,
    '--tx-out',
    `${item.address}+${outputLovelace}+1 ${assetUnitFor(item.target_handle)}`,
  ];
  if (datumPath) args.push('--tx-out-inline-datum-cbor-file', datumPath);
  args.push('--tx-out-reference-script-file', scriptPath, '--fee', String(HANDLE_REFRESH_FEE), '--out-file', txbodyPath);
  execFileSync('cardano-cli', args, { stdio: 'inherit' });

  const txid = txidFor(txbodyPath);
  const cborPath = path.join(dir, 'tx.cbor');
  const built = buildFullTx(txbodyPath, witnessHexes, cborPath);
  const summary = {
    order: item.order,
    kind: 'historical_personalization_refresh',
    source_handle: item.source_handle,
    source_validator_hash: item.source_row.validator_hash,
    target_handle: item.target_handle,
    target_utxo: targetRecord.utxo,
    funding_ref: fundingRef,
    funding_lovelace: String(fundingAmount),
    target_lovelace_before: String(targetLovelace),
    min_lovelace: String(minLovelace),
    output_lovelace: String(outputLovelace),
    fee: String(HANDLE_REFRESH_FEE),
    txid,
    txbody: txbodyPath,
    cbor: cborPath,
    cbor_hex: `${cborPath}.hex`,
    native_script_count: built.native_script_count,
    full_tx_bytes: built.bytes,
    estimated_size_with_2_vkeys: built.estimated_size_with_2_vkeys,
    estimated_size_with_3_vkeys: built.estimated_size_with_3_vkeys,
    leaves_output_without_datum: !datumPath,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  const userAgent = loadUserAgent();
  fs.mkdirSync(OUT, { recursive: true });

  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`missing inventory file: ${INVENTORY_PATH}`);
  }
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const desired = inventory.desired_reassignment_order;
  if (desired.length === 0) {
    throw new Error('no historical personalization reassignment plan found');
  }

  const handlesByName = new Map([
    ...inventory.legacy_handles.map((row) => [row.handle, row]),
    ...inventory.family_handles.map((row) => [row.handle, row]),
  ]);

  const protocolParamsPath = EXISTING_PROTOCOL_PARAMS;
  const witnessHexes = readWitnessHexes();

  const plan = [];
  for (const [index, row] of desired.entries()) {
    const targetRecord = await fetchHandle(row.target_handle, userAgent);
    const targetOutput = await fetchOutput(targetRecord.utxo, userAgent);
    const sourceRow = handlesByName.get(row.source_handle);
    if (!sourceRow) {
      throw new Error(`missing source row for ${row.source_handle}`);
    }
    const sourceScriptCbor = sourceRow.script_cbor || (await fetchJson(`${API_BASE}/handles/${encodeURIComponent(row.source_handle)}/script`, userAgent)).cbor;
    const sourceDatumHex = sourceRow.datum_cbor || (await fetchText(`${API_BASE}/handles/${encodeURIComponent(row.source_handle)}/datum`, userAgent));
    const datumBytes = sourceDatumHex ? Buffer.from(sourceDatumHex, 'hex') : null;
    const tmpDir = path.join(OUT, `tmp-${index}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const { minLovelace } = await calculateMinRequiredUtxo({
      protocolParamsPath,
      address: targetRecord.resolved_addresses?.ada || targetRecord.resolved_addresses,
      handle: row.target_handle,
      datumBytes,
      scriptCborHex: sourceScriptCbor,
      workDir: tmpDir,
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const targetLovelace = BigInt(targetOutput.value);
    const desiredLovelace = minLovelace + SCRIPT_OUTPUT_BUFFER;
    const outputLovelace = targetLovelace > desiredLovelace ? targetLovelace : desiredLovelace;
    plan.push({
      order: index + 1,
      slug: row.target_handle.split('@')[0],
      source_handle: row.source_handle,
      source_row: sourceRow,
      target_handle: row.target_handle,
      target_utxo: targetRecord.utxo,
      address: targetRecord.resolved_addresses?.ada || targetRecord.resolved_addresses,
      min_lovelace: minLovelace,
      output_lovelace: outputLovelace,
      required_funding: outputLovelace + HANDLE_REFRESH_FEE - targetLovelace,
    });
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(EXISTING_PROTOCOL_PARAMS, path.join(OUT, 'cli-protocol-params.json'));
  fs.writeFileSync(path.join(OUT, 'plan.json'), `${stringifyJson(plan)}\n`);
  const fanout = await buildFundingFanout({ plan, protocolParamsPath, userAgent, witnessHexes });

  const manifest = [fanout.summary];
  for (const item of plan) {
    const summary = await buildHistoricalRefresh(item, {
      protocolParamsPath,
      userAgent,
      witnessHexes,
      fundingRef: `${fanout.txid}#${item.order - 1}`,
      fundingAmount: item.required_funding,
    });
    manifest.push(summary);
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${stringifyJson(manifest)}\n`);
  const readme = [
    '# Mainnet Historical Personalization Reassignment',
    '',
    '- Submit `00-funding-fanout` first, wait for confirmation, then submit `01` through `05` in order.',
    '- The latest live personalization contract is moved to the highest ordinal first, then older live validators are backfilled into lower ordinals.',
    '',
    '## Transactions',
    `- 00 funding fanout: ${fanout.summary.txid}`,
    ...manifest.slice(1).map((row) => `- ${String(row.order).padStart(2, '0')} ${row.source_handle} -> ${row.target_handle}: ${row.txid}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), `${readme}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

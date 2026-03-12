#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const cbor = require(path.join(WORKSPACE_ROOT, 'minting.handle.me/node_modules/cbor'));
const CSL = require(path.join(WORKSPACE_ROOT, 'minting.handle.me/node_modules/@emurgo/cardano-serialization-lib-nodejs'));

const OUT_ROOT = path.join(REPO_ROOT, 'tasks/tmp/pz-settings-cred-refresh');
const POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const HANDLE = 'pz_settings';
const HANDLE_UNIT = `${POLICY}.000de140${Buffer.from(HANDLE, 'utf8').toString('hex')}`;
const FEE = 1200000n;
const MIN_CHANGE_LOVELACE = 1500000n;
const NETWORKS = {
  preview: {
    apiBase: 'https://preview.api.handle.me',
    koiosBase: 'https://preview.koios.rest/api/v1',
    loadWitnessHexes: () => [
      JSON.parse(
        fs.readFileSync(
          path.join(REPO_ROOT, 'docs/spec/assets/preview-wallet-payment-native-script.json'),
          'utf8'
        )
      ).native_script_cbor_hex,
    ],
  },
  preprod: {
    apiBase: 'https://preprod.api.handle.me',
    koiosBase: 'https://preprod.koios.rest/api/v1',
    loadWitnessHexes: () => {
      const hexes = JSON.parse(
        fs.readFileSync(
          path.join(WORKSPACE_ROOT, 'adahandle-deployments/tasks/tmp/preprod-contract-migration/preprod-xrs-native-scripts.json'),
          'utf8'
        )
      );
      return [hexes[0]];
    },
  },
  mainnet: {
    apiBase: 'https://api.handle.me',
    koiosBase: 'https://api.koios.rest/api/v1',
    loadWitnessHexes: () => [
      JSON.parse(
        fs.readFileSync(
          path.join(WORKSPACE_ROOT, 'adahandle-deployments/tasks/tmp/mainnet-contract-migration/mainnet-wallet-payment-native-script.json'),
          'utf8'
        )
      ).native_script_cbor_hex,
    ],
  },
};

function loadUserAgent() {
  for (const envPath of [
    path.join(REPO_ROOT, '.env.local'),
    path.join(REPO_ROOT, '.env'),
    path.join(WORKSPACE_ROOT, 'kora-bot/.env.local'),
    path.join(WORKSPACE_ROOT, 'kora-bot/.env'),
  ]) {
    if (!fs.existsSync(envPath)) continue;
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((row) => row.startsWith('KORA_USER_AGENT='));
    if (line) return line.split('=', 2)[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return 'kora-backend-request/1.0';
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
  if (!response.ok) {
    throw new Error(`fetch ${url} -> ${response.status}`);
  }
  return (await response.text()).trim();
}

async function fetchTxOutput(network, txHash, outputIndex, userAgent) {
  const rows = await fetchJson(`${NETWORKS[network].koiosBase}/tx_utxos`, userAgent, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _tx_hashes: [txHash] }),
  });
  const row = rows[0];
  if (!row) throw new Error(`missing tx_utxos row for ${txHash}`);
  const output = row.outputs.find(
    (entry) =>
      String(entry.tx_index ?? entry.output_index) === String(outputIndex)
  );
  if (!output) throw new Error(`missing output ${txHash}#${outputIndex}`);
  return output;
}

async function fetchCredentialUtxos(network, paymentCred, userAgent) {
  return await fetchJson(`${NETWORKS[network].koiosBase}/credential_utxos`, userAgent, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _payment_credentials: [paymentCred] }),
  });
}

async function pickFundingUtxo(network, utxos, excludedRef, userAgent) {
  const candidates = [...utxos]
    .map((utxo) => ({
      ...utxo,
      ref: `${utxo.tx_hash}#${utxo.tx_index}`,
      lovelace: BigInt(utxo.value),
    }))
    .filter(
      (utxo) =>
        utxo.ref !== excludedRef && utxo.lovelace > FEE + MIN_CHANGE_LOVELACE
    )
    .sort((left, right) => Number(left.lovelace - right.lovelace));

  for (const candidate of candidates) {
    const output = await fetchTxOutput(
      network,
      candidate.tx_hash,
      candidate.tx_index,
      userAgent
    );
    if (
      (output.asset_list || []).length === 0 &&
      !output.inline_datum &&
      !output.reference_script
    ) {
      return {
        ...candidate,
        address: output.payment_addr?.bech32 || null,
      };
    }
  }

  return null;
}

function buildPatchedDatum(oldDatumHex, newCredHex) {
  const fields = cbor.decodeFirstSync(Buffer.from(oldDatumHex, 'hex'));
  if (!Array.isArray(fields) || fields.length !== 9) {
    throw new Error('pz_settings datum is not the expected 9-field list');
  }
  const oldCredHex = Buffer.from(fields[6]).toString('hex');
  fields[6] = Buffer.from(newCredHex, 'hex');
  return {
    oldCredHex,
    newDatumBytes: cbor.encode(fields),
  };
}

function extractBodyBytes(txbodyPath) {
  const txbody = JSON.parse(fs.readFileSync(txbodyPath, 'utf8'));
  const raw = Buffer.from(txbody.cborHex, 'hex');
  try {
    return Buffer.from(CSL.TransactionBody.from_bytes(raw).to_bytes());
  } catch (_) {
    return Buffer.from(CSL.Transaction.from_bytes(raw).body().to_bytes());
  }
}

function buildFullTx(txbodyPath, witnessHexes, outPath) {
  const body = CSL.TransactionBody.from_bytes(extractBodyBytes(txbodyPath));
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
  fs.writeFileSync(`${outPath}.hex`, bytes.toString('hex'));
  return bytes.length;
}

function txidFor(txbodyPath) {
  return JSON.parse(
    execFileSync(
      'cardano-cli',
      ['conway', 'transaction', 'txid', '--tx-body-file', txbodyPath, '--output-json'],
      { encoding: 'utf8' }
    )
  ).txhash;
}

async function buildNetwork(network, userAgent) {
  const config = NETWORKS[network];
  const outDir = path.join(OUT_ROOT, network);
  fs.mkdirSync(outDir, { recursive: true });

  const handle = await fetchJson(
    `${config.apiBase}/handles/${encodeURIComponent(HANDLE)}`,
    userAgent
  );
  const datumHex = await fetchText(
    `${config.apiBase}/handles/${encodeURIComponent(HANDLE)}/datum`,
    userAgent
  );
  const [txHash, outputIndex] = String(handle.utxo).split('#');
  const output = await fetchTxOutput(network, txHash, Number(outputIndex), userAgent);
  const paymentCred = String(output.payment_addr?.cred || '').trim();
  if (!paymentCred) throw new Error(`${network} ${HANDLE} output missing payment credential`);

  const { oldCredHex, newDatumBytes } = buildPatchedDatum(datumHex, paymentCred);
  const summary = {
    network,
    handle: HANDLE,
    handle_utxo: handle.utxo,
    payment_credential: paymentCred,
    old_settings_cred: oldCredHex,
    needs_refresh: oldCredHex !== paymentCred,
  };

  if (oldCredHex === paymentCred) {
    fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const funding = await pickFundingUtxo(
    network,
    await fetchCredentialUtxos(network, paymentCred, userAgent),
    handle.utxo,
    userAgent
  );
  if (!funding) throw new Error(`no funding utxo found for ${network} ${paymentCred}`);

  const datumPath = path.join(outDir, 'patched.inline-datum.cbor');
  fs.writeFileSync(path.join(outDir, 'old.inline-datum.cbor'), Buffer.from(datumHex, 'hex'));
  fs.writeFileSync(datumPath, newDatumBytes);

  const pzLovelace = BigInt(output.value);
  const changeLovelace = funding.lovelace - FEE;
  const address = output.payment_addr?.bech32 || handle.resolved_addresses?.ada;
  if (!address) throw new Error(`${network} ${HANDLE} output missing address`);

  const txbodyPath = path.join(outDir, `${HANDLE}.refresh.txbody`);
  execFileSync(
    'cardano-cli',
    [
      'conway',
      'transaction',
      'build-raw',
      '--tx-in',
      handle.utxo,
      '--tx-in',
      funding.ref,
      '--tx-out',
      `${address}+${pzLovelace}+1 ${HANDLE_UNIT}`,
      '--tx-out-inline-datum-cbor-file',
      datumPath,
      '--tx-out',
      `${address}+${changeLovelace}`,
      '--fee',
      String(FEE),
      '--out-file',
      txbodyPath,
    ],
    { stdio: 'inherit' }
  );

  const fullTxPath = path.join(outDir, `${HANDLE}.refresh.full.tx.cbor`);
  const txid = txidFor(txbodyPath);
  const fullTxSize = buildFullTx(txbodyPath, config.loadWitnessHexes(), fullTxPath);
  Object.assign(summary, {
    funding_utxo: funding.ref,
    funding_lovelace: String(funding.lovelace),
    patched_settings_cred: paymentCred,
    txid,
    txbody: txbodyPath,
    full_tx_cbor: fullTxPath,
    full_tx_cbor_hex: `${fullTxPath}.hex`,
    full_tx_size: fullTxSize,
    output_lovelace: String(pzLovelace),
    change_lovelace: String(changeLovelace),
  });
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  const requested = process.argv.slice(2);
  const networks = requested.length > 0 ? requested : Object.keys(NETWORKS);
  for (const network of networks) {
    if (!NETWORKS[network]) {
      throw new Error(`unsupported network ${network}`);
    }
  }

  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  const userAgent = loadUserAgent();
  const manifest = [];
  for (const network of networks) {
    manifest.push(await buildNetwork(network, userAgent));
  }
  fs.writeFileSync(path.join(OUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

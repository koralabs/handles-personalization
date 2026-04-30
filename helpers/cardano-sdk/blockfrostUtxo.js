import { Cardano, Serialization } from "./index.js";

const parseBlockfrostValue = (amounts) => {
  let coins = 0n;
  const assets = new Map();
  for (const { unit, quantity } of amounts) {
    if (unit === "lovelace") {
      coins = BigInt(quantity);
    } else {
      const policyId = unit.slice(0, 56);
      const assetName = unit.slice(56);
      const assetId = Cardano.AssetId.fromParts(
        Cardano.PolicyId(policyId),
        Cardano.AssetName(assetName)
      );
      assets.set(assetId, BigInt(quantity));
    }
  }
  return { coins, ...(assets.size > 0 ? { assets } : {}) };
};

const blockfrostUtxoToCore = (item, address) => {
  const txIn = {
    txId: Cardano.TransactionId(item.tx_hash),
    index: item.output_index,
    address,
  };
  const txOut = {
    address,
    value: parseBlockfrostValue(item.amount),
    ...(item.inline_datum
      ? { datum: Serialization.PlutusData.fromCbor(item.inline_datum).toCore() }
      : {}),
    // Surface the reference script hash so callers can detect "this UTxO
    // already has a ref script attached" without needing to fetch the bytes.
    // We don't fetch the bytes because (a) it's a separate Blockfrost endpoint
    // call per UTxO, and (b) Conway requires re-attached scripts to round-trip
    // exactly, so the cleanest path is to skip already-deployed UTxOs entirely.
    ...(item.reference_script_hash
      ? { referenceScriptHash: item.reference_script_hash }
      : {}),
  };
  return [txIn, txOut];
};

export const fetchBlockfrostUtxos = async (
  address,
  apiKey,
  network,
  fetchFn = fetch,
  { excludeWithReferenceScripts = false } = {}
) => {
  const host = `https://cardano-${network}.blockfrost.io/api/v0`;
  const allUtxos = [];
  let page = 1;
  while (true) {
    const response = await fetchFn(
      `${host}/addresses/${address}/utxos?page=${page}&count=100`,
      { headers: { "Content-Type": "application/json", project_id: apiKey } }
    );
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Blockfrost UTxO fetch: HTTP ${response.status}`);
    }
    const items = await response.json();
    if (items.length === 0) break;
    for (const item of items) {
      if (excludeWithReferenceScripts && item.reference_script_hash) continue;
      allUtxos.push(blockfrostUtxoToCore(item, address));
    }
    if (items.length < 100) break;
    page += 1;
  }
  return allUtxos;
};

export const fetchBlockfrostTxOutput = async (txHash, outputIndex, apiKey, network, fetchFn = fetch) => {
  const host = `https://cardano-${network}.blockfrost.io/api/v0`;
  const response = await fetchFn(`${host}/txs/${txHash}/utxos`, {
    headers: { "Content-Type": "application/json", project_id: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Blockfrost tx outputs fetch: HTTP ${response.status}`);
  }
  const body = await response.json();
  const output = (body.outputs || []).find((entry) => entry.output_index === outputIndex);
  if (!output) {
    throw new Error(`tx ${txHash}#${outputIndex} not found`);
  }
  return output;
};

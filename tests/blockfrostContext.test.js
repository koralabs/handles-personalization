import assert from "node:assert/strict";
import test from "node:test";
import { getBlockfrostBuildContext } from "../helpers/cardano-sdk/blockfrostContext.js";

const params = {
  coins_per_utxo_size: "4310", max_tx_size: 16384, max_block_size: 90112, max_block_header_size: 1100,
  key_deposit: "2000000", pool_deposit: "500000000", e_max: 18, n_opt: 500, a0: 0.3, rho: 0.003, tau: 0.2,
  min_pool_cost: "170000000", protocol_major_ver: 10, protocol_minor_ver: 0, max_val_size: "5000",
  collateral_percent: 150, max_collateral_inputs: 3,
  cost_models_raw: { PlutusV1: [1, "2"], PlutusV3: [3], PlutusV9: [9], PlutusV2: "notarray" },
  price_mem: 0.0577, price_step: 0.0000721, max_tx_ex_mem: "14000000", max_tx_ex_steps: "10000000000",
  max_block_ex_mem: "62000000", max_block_ex_steps: "20000000000", min_fee_a: 44, min_fee_b: 155381,
};

const fakeFetch = (overrides = {}, status = 200, urls = []) => async (url, init) => {
  urls.push([url, init.headers.project_id]);
  const body = url.endsWith("/parameters") ? { ...params, ...overrides } : {};
  return new Response(JSON.stringify(body), { status });
};

test("builds protocol parameters from epoch parameters, querying the three endpoints in order", async () => {
  const urls = [];
  const ctx = await getBlockfrostBuildContext("preview", "key1", { fetchFn: fakeFetch({}, 200, urls) });
  assert.deepEqual(urls.map(([u]) => u), [
    "https://cardano-preview.blockfrost.io/api/v0/blocks/latest",
    "https://cardano-preview.blockfrost.io/api/v0/genesis",
    "https://cardano-preview.blockfrost.io/api/v0/epochs/latest/parameters",
  ]);
  assert.ok(urls.every(([, key]) => key === "key1"));
  const p = ctx.protocolParameters;
  assert.equal(p.coinsPerUtxoByte, 4310);
  assert.equal(p.maxValueSize, 5000);
  assert.equal(p.minFeeRefScriptCostPerByte, "0");
  assert.equal(p.costModels.size, 2); // unknown language and non-array models skipped
  assert.deepEqual([...p.costModels.values()].map((m) => m.length).sort(), [1, 2]);
  assert.deepEqual(ctx.validityInterval, {});
});

test("falls back to older min-utxo fields", async () => {
  const noSize = { coins_per_utxo_size: undefined, coins_per_utxo_word: 7 };
  const a = await getBlockfrostBuildContext("preview", "k", { fetchFn: fakeFetch(noSize) });
  assert.equal(a.protocolParameters.coinsPerUtxoByte, 7);
  const b = await getBlockfrostBuildContext("preview", "k", { fetchFn: fakeFetch({ ...noSize, coins_per_utxo_word: undefined }) });
  assert.equal(b.protocolParameters.coinsPerUtxoByte, 0);
});

test("fails on a non-numeric parameter and on an HTTP error", async () => {
  await assert.rejects(
    getBlockfrostBuildContext("preview", "k", { fetchFn: fakeFetch({ max_tx_size: "abc" }) }),
    /Invalid Blockfrost epoch_parameters.max_tx_size/
  );
  await assert.rejects(
    getBlockfrostBuildContext("preview", "k", { fetchFn: fakeFetch({}, 403) }),
    /Blockfrost \/blocks\/latest: HTTP 403/
  );
});

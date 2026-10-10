import assert from "node:assert/strict";
import test from "node:test";

import { fetchBlockfrostTxOutput, fetchBlockfrostUtxos } from "../helpers/cardano-sdk/blockfrostUtxo.js";

const ADDRESS = "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej";
const TX_HASH = "11".repeat(32);
const ASSET_ID = `${"ab".repeat(28)}000643b068616e646c65`;
const item = (index, overrides = {}) => ({
  tx_hash: TX_HASH,
  output_index: index,
  amount: [{ unit: "lovelace", quantity: "2000000" }],
  ...overrides,
});
const coreUtxo = (index) => [
  { txId: TX_HASH, index, address: ADDRESS },
  { address: ADDRESS, value: { coins: 2000000n } },
];
const jsonResponse = (body) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

// Reject unexpected pages at the network boundary so pagination regressions cannot hang.
const pageFetch = (responses, requests) => async (url, options) => {
  requests.push({ url, options });
  const page = Number(new URL(url).searchParams.get("page"));
  assert.equal(page, requests.length, "pages must advance once per request");
  assert.ok(page >= 1 && page <= responses.length, `unexpected page ${page}`);
  const response = responses[page - 1];
  return typeof response === "number"
    ? new Response("unavailable", { status: response })
    : jsonResponse(response);
};

const expectedRequest = (page) => ({
  url: `https://cardano-preview.blockfrost.io/api/v0/addresses/${ADDRESS}/utxos?page=${page}&count=100`,
  options: { headers: { "Content-Type": "application/json", project_id: "test-key" } },
});

test("collects every UTxO across full and partial pages in order", async () => {
  // Feature: wallet selection sees all UTxOs, including ones beyond the first page.
  // Failure: early termination, repeated pages, or dropped output indices lose funds.
  // Negative control: removing page increment or stopping after page one fails equality.
  const requests = [];
  const first = Array.from({ length: 100 }, (_, index) => item(index));
  const result = await fetchBlockfrostUtxos(ADDRESS, "test-key", "preview",
    pageFetch([first, [item(100), item(101)]], requests));
  assert.deepEqual(result, Array.from({ length: 102 }, (_, index) => coreUtxo(index)));
  assert.deepEqual(requests, [expectedRequest(1), expectedRequest(2)]);
});

test("continues past a full page containing only excluded reference scripts", async () => {
  // Feature: excluding deployed scripts still finds clean funding on later pages.
  // Failure: pagination based on the filtered count hides eligible wallet inputs.
  // Negative control: terminating when the filtered page is empty loses output 100.
  const requests = [];
  const first = Array.from({ length: 100 }, (_, index) => item(index, {
    reference_script_hash: "cd".repeat(28),
  }));
  const result = await fetchBlockfrostUtxos(ADDRESS, "test-key", "preview",
    pageFetch([first, [item(100)]], requests), { excludeWithReferenceScripts: true });
  assert.deepEqual(result, [coreUtxo(100)]);
  assert.deepEqual(requests, [expectedRequest(1), expectedRequest(2)]);
});

test("preserves exact quantities, inline datum, and reference-script metadata", async () => {
  // Feature: ledger values and datum survive conversion without precision loss.
  // Failure: Number conversion rounds large quantities or drops native assets/metadata.
  // Negative control: replacing BigInt with Number or omitting datum fails deep equality.
  const referenceScriptHash = "cd".repeat(28);
  const result = await fetchBlockfrostUtxos(ADDRESS, "test-key", "preview", async () =>
    jsonResponse([item(7, {
      amount: [
        { unit: "lovelace", quantity: "9007199254740993" },
        { unit: ASSET_ID, quantity: "9007199254740995" },
      ],
      inline_datum: "182a",
      reference_script_hash: referenceScriptHash,
    }), item(8)]));
  assert.deepEqual(result, [[
    { txId: TX_HASH, index: 7, address: ADDRESS },
    {
      address: ADDRESS,
      value: { coins: 9007199254740993n, assets: new Map([[ASSET_ID, 9007199254740995n]]) },
      datum: 42n,
      referenceScriptHash,
    },
  ], coreUtxo(8)]);
});

test("empty pages and 404 terminate without losing earlier UTxOs", async (t) => {
  // Feature: exhausted address history returns all previously collected wallet inputs.
  // Failure: treating exhaustion as an error or clearing accumulated inputs loses funds.
  // Negative control: throwing on 404 or returning [] on page two fails these cases.
  for (const terminal of [[], 404]) {
    for (const populated of [false, true]) {
      await t.test(`${JSON.stringify(terminal)} after ${populated ? "full page" : "no inputs"}`, async () => {
        const requests = [];
        const first = Array.from({ length: 100 }, (_, index) => item(index));
        const result = await fetchBlockfrostUtxos(ADDRESS, "test-key", "preview",
          pageFetch(populated ? [first, terminal] : [terminal], requests));
        assert.deepEqual(result, populated ? first.map((_, index) => coreUtxo(index)) : []);
        assert.deepEqual(requests, populated
          ? [expectedRequest(1), expectedRequest(2)] : [expectedRequest(1)]);
      });
    }
  }
});

test("UTxO fetch rejects HTTP failures instead of returning partial funds", async (t) => {
  // Feature: failed wallet enumeration cannot be mistaken for a complete balance.
  // Failure: treating unauthorized or later-page failures as exhaustion returns partial data.
  // Negative control: breaking instead of throwing on !ok makes rejects fail.
  for (const responses of [[403], [Array.from({ length: 100 }, (_, index) => item(index)), 500]]) {
    await t.test(`HTTP ${responses.at(-1)}`, async () => {
      await assert.rejects(fetchBlockfrostUtxos(ADDRESS, "test-key", "preview",
        pageFetch(responses, [])), { message: `Blockfrost UTxO fetch: HTTP ${responses.at(-1)}` });
    });
  }
});

test("transaction output lookup selects output_index rather than array position", async () => {
  // Feature: callers retrieve the requested ledger output with its original metadata.
  // Failure: indexing the response array directly returns the wrong output or none.
  // Negative control: using outputs[outputIndex] instead of find fails output 7 equality.
  const expected = { ...item(7), address: ADDRESS, inline_datum: "182a", reference_script_hash: "cd".repeat(28) };
  const requests = [];
  const result = await fetchBlockfrostTxOutput(TX_HASH, 7, "test-key", "preview", async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ outputs: [item(3), expected, item(0)] });
  });
  assert.deepEqual(result, expected);
  assert.deepEqual(requests, [{
    url: `https://cardano-preview.blockfrost.io/api/v0/txs/${TX_HASH}/utxos`,
    options: { headers: { "Content-Type": "application/json", project_id: "test-key" } },
  }]);
});

test("transaction output lookup rejects missing outputs with the requested reference", async (t) => {
  // Feature: a missing ledger output produces an error naming its transaction reference.
  // Failure: absent outputs silently yield undefined or an unrelated output.
  // Negative control: removing the not-found guard fails these error assertions.
  for (const body of [{}, { outputs: [] }, { outputs: [item(0)] }]) {
    await t.test(JSON.stringify(body), async () => {
      await assert.rejects(fetchBlockfrostTxOutput(TX_HASH, 7, "test-key", "preview",
        async () => jsonResponse(body)), { message: `tx ${TX_HASH}#7 not found` });
    });
  }
});

test("transaction output lookup preserves HTTP failure status", async (t) => {
  // Feature: missing transactions and provider outages remain distinct from missing outputs.
  // Failure: a failed provider response is parsed as a successful output response.
  // Negative control: removing the response.ok check changes the asserted error.
  for (const status of [404, 503]) {
    await t.test(`HTTP ${status}`, async () => {
      await assert.rejects(fetchBlockfrostTxOutput(TX_HASH, 7, "test-key", "preview",
        async () => new Response("unavailable", { status })),
      { message: `Blockfrost tx outputs fetch: HTTP ${status}` });
    });
  }
});

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { bech32 } from "bech32";

import { assertContractHandleReplaceable, countAssetUtxosAtScript } from "../helpers/contractHandleGuard.js";

const SCRIPT_HASH = "ab".repeat(28);
const NEXT_SCRIPT_HASH = "cd".repeat(28);
const guardArgs = {
  handleName: "persprx1@handlecontract",
  currentScriptHash: SCRIPT_HASH,
  nextScriptHash: NEXT_SCRIPT_HASH,
  network: "preview",
  blockfrostApiKey: "test-key",
};
const countArgs = { scriptHash: SCRIPT_HASH, network: "preview", blockfrostApiKey: "test-key" };
const adaOnly = () => ({ amount: [{ unit: "lovelace", quantity: "2000000" }] });
const withAssets = (address) => ({
  address,
  amount: [
    { unit: "lovelace", quantity: "2000000" },
    { unit: `${"11".repeat(28)}01`, quantity: "1" },
    { unit: `${"22".repeat(28)}02`, quantity: "3" },
  ],
});
const fullAdaPage = () => Array.from({ length: 100 }, adaOnly);

// Only configured network responses are available; an extra page fails immediately.
const mockFetch = (pages, requests, registryStatus = 200) => async (url, options) => {
  requests.push(String(url));
  if (url === "https://preview.api.handle.me/scripts") {
    return new Response("{}", { status: registryStatus });
  }
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://cardano-preview.blockfrost.io");
  const credential = parsed.pathname.split("/").at(-2);
  const decoded = bech32.decode(credential);
  assert.equal(decoded.prefix, "script");
  assert.equal(Buffer.from(bech32.fromWords(decoded.words)).toString("hex"), SCRIPT_HASH);
  assert.equal(parsed.pathname, `/api/v0/addresses/${credential}/utxos`);
  assert.equal(parsed.searchParams.get("count"), "100");
  assert.deepEqual(options.headers, { "Content-Type": "application/json", project_id: "test-key" });
  const page = Number(parsed.searchParams.get("page"));
  assert.equal(page, requests.length, "pages must advance once per request");
  assert.ok(page >= 1 && page <= pages.length, `unexpected page ${page}`);
  const response = pages[page - 1];
  return typeof response === "number"
    ? new Response("unavailable", { status: response })
    : new Response(JSON.stringify(response));
};

const requestedPages = (requests) => requests.map((url) => Number(new URL(url).searchParams.get("page")));

test("counts asset-bearing UTxOs across pages and stake variants once each", async () => {
  // Feature: every asset-bearing output under the script contributes to replacement safety.
  // Failure: ADA-only outputs inflate the count, or later pages/stake variants are missed.
  // Negative control: stopping at page one returns zero; counting tokens returns four.
  const requests = [];
  const result = await countAssetUtxosAtScript({
    ...countArgs,
    fetchFn: mockFetch([fullAdaPage(), [withAssets("stake-variant-a"), withAssets("stake-variant-b"), adaOnly()]], requests),
  });
  assert.equal(result, 2);
  assert.deepEqual(requestedPages(requests), [1, 2]);
});

test("empty and 404 pages retain the accumulated locked-asset count", async (t) => {
  // Feature: normal pagination exhaustion preserves the known count of locked outputs.
  // Failure: exhaustion resets the count and permits an unsafe script replacement.
  // Negative control: returning zero on a terminal page fails the populated cases.
  for (const terminal of [[], 404]) {
    for (const populated of [false, true]) {
      await t.test(`${JSON.stringify(terminal)} after ${populated ? "full page" : "no inputs"}`, async () => {
        const requests = [];
        const first = fullAdaPage();
        first[99] = withAssets("stake-variant-a");
        const result = await countAssetUtxosAtScript({
          ...countArgs,
          fetchFn: mockFetch(populated ? [first, terminal] : [terminal], requests),
        });
        assert.equal(result, populated ? 1 : 0);
        assert.deepEqual(requestedPages(requests), populated ? [1, 2] : [1]);
      });
    }
  }
});

test("asset enumeration rejects provider errors instead of returning a partial count", async (t) => {
  // Feature: authorization failures and outages cannot look like an empty script credential.
  // Failure: swallowing a provider error makes replacement proceed with incomplete evidence.
  // Negative control: breaking on !ok instead of throwing fails the rejection assertions.
  for (const pages of [[403], [fullAdaPage(), 502]]) {
    await t.test(`HTTP ${pages.at(-1)}`, async () => {
      await assert.rejects(countAssetUtxosAtScript({
        ...countArgs,
        fetchFn: mockFetch(pages, []),
      }), new RegExp(`Blockfrost credential UTxO fetch for script1.*: HTTP ${pages.at(-1)}`));
    });
  }
});

test("replacement refuses to strand assets found only after the first page", async (t) => {
  // Feature: reference-script replacement protects handles locked on any history page.
  // Failure: checking only the first all-ADA page wrongly authorizes replacement.
  // Negative control: removing page increment makes the guard resolve and rejects fail.
  const requests = [];
  t.mock.method(globalThis, "fetch", mockFetch([
    fullAdaPage(), [withAssets("stake-variant-a"), withAssets("stake-variant-b")],
  ], requests));
  await assert.rejects(assertContractHandleReplaceable(guardArgs), {
    message: `refusing to replace persprx1@handlecontract's reference script ${SCRIPT_HASH}: 2 asset UTxO(s) are still locked under it. ` +
      "Deploy the new script to the next <slug><ordinal>@handlecontract (see adahandle-deployments/common/discover_subhandles.py) instead.",
  });
  assert.deepEqual(requestedPages(requests.slice(0, 2)), [1, 2]);
  assert.equal(requests[2], "https://preview.api.handle.me/scripts");
  assert.equal(requests.length, 3);
});

test("replacement stops when the locked-asset provider fails", async (t) => {
  // Feature: a failed locked-asset lookup blocks replacement before registry evaluation.
  // Failure: treating the failed lookup as zero assets permits an unsafe replacement.
  // Negative control: catching enumeration errors and using zero makes rejects fail.
  const requests = [];
  t.mock.method(globalThis, "fetch", mockFetch([503], requests));
  await assert.rejects(assertContractHandleReplaceable(guardArgs),
    /Blockfrost credential UTxO fetch for script1.*: HTTP 503/);
  assert.deepEqual(requestedPages(requests), [1]);
});

test("replacement stops when the alternative-carrier registry cannot be fetched", async (t) => {
  // Feature: locked handles retain their script when another carrier cannot be verified.
  // Failure: a registry outage is treated as proof that replacement is safe.
  // Negative control: suppressing the registry HTTP error makes these assertions fail.
  for (const status of [404, 503]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const requests = [];
      t.mock.method(globalThis, "fetch", mockFetch([[withAssets("stake-variant-a")]], requests, status));
      await assert.rejects(assertContractHandleReplaceable(guardArgs), {
        message: `api /scripts fetch: HTTP ${status}`,
      });
      assert.equal(requests[1], "https://preview.api.handle.me/scripts");
      assert.equal(requests.length, 2);
    });
  }
});

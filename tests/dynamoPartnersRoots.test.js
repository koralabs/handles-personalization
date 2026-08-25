import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRootsFromEntries,
  fetchPartnersTrieRoots,
  getCachedRoots,
  makePartnersDynamoClient,
} from "../helpers/dynamoPartnersRoots.js";

const POLICY_A = "a1".repeat(28);
const POLICY_B = "b2".repeat(28);
const POLICY_C = "c3".repeat(28);
const POLICY_D = "d4".repeat(28);
const ZERO_ROOT = "0".repeat(64);

const withEndpointEnv = (value, fn) => {
  const originalDynamo = process.env.AWS_ENDPOINT_URL_DYNAMODB;
  const originalAws = process.env.AWS_ENDPOINT_URL;
  try {
    if (value === undefined) {
      delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
      delete process.env.AWS_ENDPOINT_URL;
    } else {
      process.env.AWS_ENDPOINT_URL_DYNAMODB = value;
      delete process.env.AWS_ENDPOINT_URL;
    }
    return fn();
  } finally {
    if (originalDynamo === undefined) delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
    else process.env.AWS_ENDPOINT_URL_DYNAMODB = originalDynamo;
    if (originalAws === undefined) delete process.env.AWS_ENDPOINT_URL;
    else process.env.AWS_ENDPOINT_URL = originalAws;
  }
};

const fakeDynamoClient = ({ cachedItem, rowsByCategory = {} } = {}) => {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input);
      if (command.input.Key) {
        return cachedItem ? { Item: cachedItem } : {};
      }
      const policySk = command.input.ExpressionAttributeValues[":policy"];
      const category = policySk.replace("POLICY#", "");
      return { Items: rowsByCategory[category] ?? [] };
    },
  };
};

test("makePartnersDynamoClient fails loud for Scylla-backed networks without endpoint override", () => {
  withEndpointEnv(undefined, () => {
    assert.throws(
      () => makePartnersDynamoClient("mainnet"),
      /partners_mainnet is on ScyllaDB, not AWS/
    );
  });
});

test("getCachedRoots validates and normalizes cached root rows", async () => {
  const client = fakeDynamoClient({
    cachedItem: {
      bg_root: "A".repeat(64),
      pfp_root: "b".repeat(64),
      on_chain_tx_id_bg: "bg-tx",
      updated_at: "2026-08-25T00:00:00Z",
    },
  });

  const roots = await getCachedRoots({ network: "preview", dynamoClient: client });

  assert.equal(roots.table, "partners_preview");
  assert.equal(roots.bg_root, "a".repeat(64));
  assert.equal(roots.pfp_root, "b".repeat(64));
  assert.equal(roots.on_chain_tx_id_bg, "bg-tx");
  assert.equal(roots.on_chain_tx_id_pfp, null);
  assert.deepEqual(client.calls[0].Key, { policy_id: "__ROOTS__", sk: "STATE" });
});

test("computeRootsFromEntries scans both partner categories and deduplicates legacy policy rows", async () => {
  const client = fakeDynamoClient({
    rowsByCategory: {
      bg: [
        { policy_id: POLICY_A, sk: "META", bg: true, nsfw: 0 },
        { policy_id: POLICY_A, sk: "POLICY#bg", nsfw: 1 },
        { policy_id: POLICY_B, sk: "POLICY#bg", nsfw: 1 },
        { policy_id: POLICY_C, sk: "OVERRIDE#bg#74657374", asset_name_hex: "74657374", nsfw: 1 },
        { policy_id: "GROUP#ignored", sk: "META", bg: true, nsfw: 1 },
        { policy_id: POLICY_D, sk: "META", bg: false, nsfw: 1 },
      ],
      pfp: [{ policy_id: POLICY_D, sk: "META", pfp: true, nsfw: 0 }],
    },
  });

  const roots = await computeRootsFromEntries({ network: "preview", dynamoClient: client });

  assert.equal(roots.table, "partners_preview");
  assert.equal(roots.bg_entry_count, 3);
  assert.equal(roots.pfp_entry_count, 1);
  assert.match(roots.bg_root, /^[0-9a-f]{64}$/);
  assert.match(roots.pfp_root, /^[0-9a-f]{64}$/);
  assert.notEqual(roots.bg_root, ZERO_ROOT);
  assert.notEqual(roots.pfp_root, ZERO_ROOT);
  assert.deepEqual(
    client.calls.slice(0, 2).map((call) => call.ExpressionAttributeValues[":policy"]),
    ["POLICY#bg", "POLICY#pfp"]
  );
});

test("fetchPartnersTrieRoots uses cached roots when available and computes otherwise", async () => {
  const cachedClient = fakeDynamoClient({
    cachedItem: { bg_root: "1".repeat(64), pfp_root: "2".repeat(64) },
  });
  const cached = await fetchPartnersTrieRoots({ network: "preview", dynamoClient: cachedClient });
  assert.equal(cached.source, "cached");
  assert.equal(cachedClient.calls.length, 1);

  const computedClient = fakeDynamoClient({ rowsByCategory: { bg: [], pfp: [] } });
  const computed = await fetchPartnersTrieRoots({ network: "preview", dynamoClient: computedClient });
  assert.equal(computed.source, "computed");
  assert.equal(computed.bg_root, ZERO_ROOT);
  assert.equal(computed.pfp_root, ZERO_ROOT);
  assert.equal(computedClient.calls.length, 3);
});

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { Trie } from "@aiken-lang/merkle-patricia-forestry";

// Reads partners-trie roots from the partners_{network} DynamoDB table.
//
// Schema (matches handle.me feature/partners-mpt-foundations branch's
// bff/lib/repos/Partners.ts):
//
//   Table: partners_{network}
//   Roots row (cached): policy_id='__ROOTS__', sk='STATE'
//                       fields: bg_root, pfp_root, on_chain_tx_id_bg,
//                               on_chain_tx_id_pfp, updated_at
//   Policy entry:       policy_id=<28-byte hex>, sk='POLICY#bg' | 'POLICY#pfp'
//                       fields: nsfw (0 or 1)
//   Override entry:     policy_id=<28-byte hex>,
//                       sk='OVERRIDE#bg#<asset_hex>' | 'OVERRIDE#pfp#<asset_hex>'
//                       fields: asset_name_hex, nsfw, reason?
//
// `getRoots` returns the cached row if present; throws otherwise.
// `computeRootsFromEntries` rebuilds bg + pfp tries from POLICY/OVERRIDE
// rows and returns the on-the-fly hashes — for cutover use *before* the
// cached row is seeded.

const PARTNERS_TABLE_BASE = "partners";
const ROOTS_PK = "__ROOTS__";
const ROOTS_SK = "STATE";

const partnersTableForNetwork = (network) => `${PARTNERS_TABLE_BASE}_${network}`;

const validate32ByteHex = (label, value) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 32-byte hex string, got: ${typeof value === "string" ? value : typeof value}`);
  }
  return value.toLowerCase();
};

const policySkForCategory = (cat) => `POLICY#${cat}`;
const overrideSkPrefix = (cat) => `OVERRIDE#${cat}#`;

const buildTrieEntries = (rows, category) => {
  const policySk = policySkForCategory(category);
  const overridePrefix = overrideSkPrefix(category);
  const entries = [];
  for (const row of rows) {
    if (row.sk === policySk) {
      entries.push({
        type: "policy",
        policyId: row.policy_id,
        nsfw: row.nsfw === 1 ? 1 : 0,
      });
    } else if (typeof row.sk === "string" && row.sk.startsWith(overridePrefix)) {
      entries.push({
        type: "override",
        policyId: row.policy_id,
        assetNameHex: row.asset_name_hex,
        nsfw: row.nsfw === 1 ? 1 : 0,
      });
    }
  }
  return entries;
};

const trieFromEntries = async (entries) => {
  const items = entries.map((e) => {
    const policyIdBuf = Buffer.from(e.policyId, "hex");
    if (e.type === "policy") {
      return { key: policyIdBuf, value: Buffer.from([e.nsfw]) };
    }
    const assetBuf = Buffer.from(e.assetNameHex, "hex");
    const key = Buffer.concat([policyIdBuf, assetBuf]);
    return { key, value: Buffer.from([e.nsfw]) };
  });
  return Trie.fromList(items);
};

const scanCategoryEntries = async (client, tableName, category) => {
  const policySk = policySkForCategory(category);
  const overridePrefix = overrideSkPrefix(category);
  const entries = [];
  let lastKey;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "sk = :policy OR begins_with(sk, :ovr)",
        ExpressionAttributeValues: {
          ":policy": policySk,
          ":ovr": overridePrefix,
        },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of result.Items ?? []) entries.push(item);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return entries;
};

// Reads the cached roots row. Returns the row or null.
export const getCachedRoots = async ({ network, dynamoClient } = {}) => {
  if (!network) throw new Error("getCachedRoots: network is required");
  const client = dynamoClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const tableName = partnersTableForNetwork(network);
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { policy_id: ROOTS_PK, sk: ROOTS_SK },
    })
  );
  if (!result.Item) return null;
  return {
    network,
    table: tableName,
    bg_root: validate32ByteHex(`${tableName}.bg_root`, result.Item.bg_root),
    pfp_root: validate32ByteHex(`${tableName}.pfp_root`, result.Item.pfp_root),
    on_chain_tx_id_bg: result.Item.on_chain_tx_id_bg ?? null,
    on_chain_tx_id_pfp: result.Item.on_chain_tx_id_pfp ?? null,
    updated_at: result.Item.updated_at ?? null,
  };
};

// Compute fresh per-category roots from POLICY/OVERRIDE rows. Used at
// cutover time when the cached __ROOTS__ row hasn't been seeded yet.
export const computeRootsFromEntries = async ({ network, dynamoClient } = {}) => {
  if (!network) throw new Error("computeRootsFromEntries: network is required");
  const client = dynamoClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const tableName = partnersTableForNetwork(network);

  const [bgRows, pfpRows] = await Promise.all([
    scanCategoryEntries(client, tableName, "bg"),
    scanCategoryEntries(client, tableName, "pfp"),
  ]);
  const bgEntries = buildTrieEntries(bgRows, "bg");
  const pfpEntries = buildTrieEntries(pfpRows, "pfp");

  const bgTrie = await trieFromEntries(bgEntries);
  const pfpTrie = await trieFromEntries(pfpEntries);

  // Trie.fromList of an empty list yields a null hash; treat that as
  // an explicit zero-trie root so the on-chain datum is unambiguous.
  const bgRoot = (bgTrie.hash ?? Buffer.alloc(32)).toString("hex");
  const pfpRoot = (pfpTrie.hash ?? Buffer.alloc(32)).toString("hex");

  return {
    network,
    table: tableName,
    bg_root: bgRoot,
    pfp_root: pfpRoot,
    bg_entry_count: bgEntries.length,
    pfp_entry_count: pfpEntries.length,
  };
};

// Cutover-friendly resolver. If the cached __ROOTS__ row is present, use it.
// Otherwise rebuild from POLICY/OVERRIDE rows. Either way returns
// { bg_root, pfp_root } as 32-byte hex.
export const fetchPartnersTrieRoots = async ({ network, dynamoClient } = {}) => {
  if (!network) throw new Error("fetchPartnersTrieRoots: network is required");
  const client = dynamoClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const cached = await getCachedRoots({ network, dynamoClient: client });
  if (cached) return { ...cached, source: "cached" };
  const computed = await computeRootsFromEntries({ network, dynamoClient: client });
  return { ...computed, source: "computed" };
};

#!/usr/bin/env node
// One-off fixture-creation step: insert the new test-bg policy into
// partners_preview DynamoDB. Optionally also writes a META row for
// display purposes. Does NOT push the new bg_root on-chain — that is
// syncBgRootOnChain.js's job.
//
// Usage: node scripts/addPolicyToPartners.js \
//          --policy-id 7978bfd1e9a80fb78516ed868d99291dc40d56332bab270b8a8085e6 \
//          --category bg \
//          --display-name "Test Boat (full creator-defaults)" \
//          --image "ipfs://QmSkgqaCapgw99Y2oAZ72tj9iGRb89DzM7kJPetvsj7NND"

import { PutCommand } from "@aws-sdk/lib-dynamodb";

import { computeRootsFromEntries, makePartnersDynamoClient } from "../helpers/dynamoPartnersRoots.js";

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[t.slice(2)] = "true";
    } else {
      args[t.slice(2)] = next;
      i += 1;
    }
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const network = (args.network || "").trim().toLowerCase();
  if (!["preview", "preprod"].includes(network)) {
    throw new Error("required: --network preview|preprod (no default)");
  }
  const TABLE_NAME = `partners_${network}`;
  const policyId = (args["policy-id"] || "").trim().toLowerCase();
  const category = args.category || "bg";
  const displayName = args["display-name"] || "Test BG (full)";
  const image = args.image || "";
  if (!/^[0-9a-f]{56}$/i.test(policyId)) {
    throw new Error(`bad --policy-id: ${policyId}`);
  }
  if (!["bg", "pfp"].includes(category)) {
    throw new Error(`bad --category: ${category}`);
  }

  const client = makePartnersDynamoClient(network);

  console.log(`Inserting POLICY#${category} row for ${policyId} into ${TABLE_NAME}`);
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        policy_id: policyId,
        sk: `POLICY#${category}`,
        nsfw: 0,
      },
    })
  );

  // META row must carry `bg: true` / `pfp: true` because the BFF reads
  // those flags to classify partner policies (META schema), while the
  // handles-personalization MPF helpers historically read POLICY#bg /
  // POLICY#pfp (legacy schema). Write both so consumers of either schema
  // resolve correctly. The previously bare META row left the BFF unable
  // to see the policy as a bg-partner.
  console.log(`Inserting META row with ${category}=true`);
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        policy_id: policyId,
        sk: "META",
        name: displayName,
        bg: category === "bg",
        pfp: category === "pfp",
        ...(image ? { image } : {}),
      },
    })
  );

  console.log(`Recomputing trie roots from POLICY/OVERRIDE rows in ${network}...`);
  const roots = await computeRootsFromEntries({ network });
  console.log(JSON.stringify(roots, null, 2));
  console.log("\nNEW BG_ROOT:", roots.bg_root);
  console.log(`Now run scripts/syncBgRootOnChain.js --network ${network} to push this on-chain.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

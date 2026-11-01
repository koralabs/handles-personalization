import assert from "node:assert/strict";
import test from "node:test";
import { Proof } from "@aiken-lang/merkle-patricia-forestry";
import {
  buildPolicyApprovalRedeemer,
  buildPolicyIndexTrie,
  encodeNsfw,
  overrideKey,
  policyKey,
} from "../mpfProofAdapter.js";

const FIXTURE_POLICY_ID =
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c";
const SECOND_POLICY_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function policyEntry(policyId, nsfw) {
  return { type: "policy", policyId, nsfw };
}

function overrideEntry(policyId, assetName, nsfw) {
  return { type: "override", policyId, assetName, nsfw };
}

test("encodeNsfw produces a single byte 0x00 or 0x01", () => {
  assert.equal(encodeNsfw(0).toString("hex"), "00");
  assert.equal(encodeNsfw(1).toString("hex"), "01");
  assert.throws(() => encodeNsfw(2));
});

test("policyKey is the raw policy id bytes", () => {
  assert.equal(policyKey(FIXTURE_POLICY_ID).toString("hex"), FIXTURE_POLICY_ID);
});

test("overrideKey concatenates policy id with asset name bytes", () => {
  const k = overrideKey(FIXTURE_POLICY_ID, "asset_x");
  assert.equal(
    k.toString("hex"),
    FIXTURE_POLICY_ID + Buffer.from("asset_x").toString("hex"),
  );
});

test("NoOverride redeemer carries valid policy + non-membership proofs", async () => {
  const entries = [
    policyEntry(FIXTURE_POLICY_ID, 0),
    policyEntry(SECOND_POLICY_ID, 1),
    overrideEntry(SECOND_POLICY_ID, "naughty_42", 1),
  ];
  const trie = await buildPolicyIndexTrie(entries);
  const redeemer = await buildPolicyApprovalRedeemer({
    trie,
    policyId: FIXTURE_POLICY_ID,
    policyNsfw: 0,
    assetName: "safe_asset",
    override: null,
  });

  assert.equal(redeemer.policy_nsfw, 0);
  assert.ok(redeemer.override.NoOverride);

  // Policy membership proof reproduces the trie root.
  const polRoot = Proof.fromJSON(
    policyKey(FIXTURE_POLICY_ID),
    encodeNsfw(0),
    aikenProofToJson(redeemer.policy_proof),
  ).verify();
  assert.equal(polRoot.toString("hex"), trie.hash.toString("hex"));

  // Override non-membership proof, verified in exclusion mode, reproduces the
  // trie root — equivalent to on-chain mpf.miss(trie, asset_key, proof).
  const ovrKeyBytes = overrideKey(FIXTURE_POLICY_ID, "safe_asset");
  const ovrRoot = Proof.fromJSON(
    ovrKeyBytes,
    undefined,
    aikenProofToJson(redeemer.override.NoOverride.proof),
  ).verify(false);
  assert.equal(ovrRoot.toString("hex"), trie.hash.toString("hex"));
});

test("buildPolicyApprovalRedeemer (WithOverride) carries override proof and nsfw", async () => {
  const entries = [
    policyEntry(SECOND_POLICY_ID, 0),
    overrideEntry(SECOND_POLICY_ID, "naughty_42", 1),
  ];
  const trie = await buildPolicyIndexTrie(entries);

  const redeemer = await buildPolicyApprovalRedeemer({
    trie,
    policyId: SECOND_POLICY_ID,
    policyNsfw: 0,
    assetName: "naughty_42",
    override: { nsfw: 1 },
  });

  assert.ok(redeemer.override.WithOverride);
  assert.equal(redeemer.override.WithOverride.nsfw, 1);

  const ovrKeyBytes = overrideKey(SECOND_POLICY_ID, "naughty_42");
  const verifiedRoot = Proof.fromJSON(
    ovrKeyBytes,
    encodeNsfw(1),
    aikenProofToJson(redeemer.override.WithOverride.proof),
  ).verify();
  assert.ok(verifiedRoot);
  assert.equal(verifiedRoot.toString("hex"), trie.hash.toString("hex"));
});

// Round-trip helper: convert Aiken-shaped proof back to the MPF JSON form
// so we can run Proof.fromJSON(...).verify() on it.
function aikenProofToJson(steps) {
  return steps.map((step) => {
    if (step.Branch) {
      return {
        type: "branch",
        skip: step.Branch.skip,
        neighbors: step.Branch.neighbors.toString("hex"),
      };
    }
    if (step.Fork) {
      return {
        type: "fork",
        skip: step.Fork.skip,
        neighbor: {
          nibble: step.Fork.neighbor.nibble,
          prefix: step.Fork.neighbor.prefix.toString("hex"),
          root: step.Fork.neighbor.root.toString("hex"),
        },
      };
    }
    if (step.Leaf) {
      return {
        type: "leaf",
        skip: step.Leaf.skip,
        neighbor: {
          key: step.Leaf.key.toString("hex"),
          value: step.Leaf.value.toString("hex"),
        },
      };
    }
    throw new Error("unknown aiken proof step");
  });
}

import { proofJsonToAikenProof } from "../mpfProofAdapter.js";

test("keys accept #-hex strings and Buffers, and reject other types", () => {
  const raw = Buffer.from(FIXTURE_POLICY_ID, "hex");
  assert.equal(policyKey("#" + FIXTURE_POLICY_ID).toString("hex"), FIXTURE_POLICY_ID);
  assert.equal(policyKey(raw), raw);
  assert.equal(overrideKey(raw, Buffer.from("ab")).toString("hex"), FIXTURE_POLICY_ID + "6162");
  assert.equal(overrideKey(FIXTURE_POLICY_ID, "#6162").toString("hex"), FIXTURE_POLICY_ID + "6162");
  assert.throws(() => policyKey(5), /policyId must be a hex string or Buffer/);
  assert.throws(() => overrideKey(FIXTURE_POLICY_ID, 5), /assetName must be a hex string or Buffer/);
});

test("buildPolicyIndexTrie rejects an unknown entry type", async () => {
  await assert.rejects(buildPolicyIndexTrie([{ type: "bogus" }]), /unknown entry type: bogus/);
});

test("proofJsonToAikenProof maps branch, fork and leaf steps and rejects others", () => {
  const out = proofJsonToAikenProof([
    { type: "branch", skip: 1, neighbors: "aabb" },
    { type: "fork", skip: 2, neighbor: { nibble: 3, prefix: "01", root: "02" } },
    { type: "leaf", skip: 4, neighbor: { key: "03", value: "04" } },
  ]);
  assert.deepEqual(out[0], { Branch: { skip: 1, neighbors: Buffer.from("aabb", "hex") } });
  assert.deepEqual(out[1], { Fork: { skip: 2, neighbor: { nibble: 3, prefix: Buffer.from("01", "hex"), root: Buffer.from("02", "hex") } } });
  assert.deepEqual(out[2], { Leaf: { skip: 4, key: Buffer.from("03", "hex"), value: Buffer.from("04", "hex") } });
  assert.throws(() => proofJsonToAikenProof([{ type: "x" }]), /unknown proof step type: x/);
});

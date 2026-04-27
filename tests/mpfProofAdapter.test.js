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

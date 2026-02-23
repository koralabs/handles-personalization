import assert from "node:assert/strict";
import test from "node:test";
import { Proof } from "@aiken-lang/merkle-patricia-forestry";
import {
  buildPolicyApprovalProof,
  buildPolicyApprovalRedeemer,
  buildPolicyIndexTrie,
  encodePolicyFlags,
  policyIndexKey,
} from "../mpfProofAdapter.js";

const FIXTURE_POLICY_ID =
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c";

const FIXTURE_ENTRIES = [
  {
    policyId: FIXTURE_POLICY_ID,
    prefix: "bg_",
    flags: { nsfw: 1, trial: 0, aux: 0 },
  },
  {
    policyId: FIXTURE_POLICY_ID,
    prefix: "pfp_",
    flags: { nsfw: 0, trial: 1, aux: 0 },
  },
];

test("encodePolicyFlags matches on-chain compact encoding", () => {
  assert.equal(
    encodePolicyFlags({ nsfw: 1, trial: 0, aux: 7 }).toString("hex"),
    "010007",
  );
  assert.equal(
    encodePolicyFlags({ nsfw: 24, trial: 25, aux: 26 }).toString("hex"),
    "18181819181a",
  );
});

test("buildPolicyApprovalProof produces stable root and proof vector", async () => {
  const trie = await buildPolicyIndexTrie(FIXTURE_ENTRIES);
  const payload = await buildPolicyApprovalProof(trie, FIXTURE_ENTRIES[0]);

  assert.equal(
    trie.hash.toString("hex"),
    "256e8792c4dd0c7ec077dd9501a7e0233bbbeb9cdf659795d5be1b4bdcd16bda",
  );
  assert.equal(
    payload.proof_cbor_hex,
    "9fd87b9f005820dee1e67fa44579fb2c71a029d1e0d2052da47a7cb6ea4dc0c90b07f7835a0e0658205c93c26839a17cb5acf27e89aac00f9dd3f51d1a1aa4b482f690f643639fe872ffff",
  );

  const key = policyIndexKey(FIXTURE_ENTRIES[0].policyId, FIXTURE_ENTRIES[0].prefix);
  const value = encodePolicyFlags(FIXTURE_ENTRIES[0].flags);
  const verifiedRoot = Proof.fromJSON(key, value, payload.proof).verify();

  assert.ok(verifiedRoot);
  assert.equal(
    verifiedRoot.toString("hex"),
    "256e8792c4dd0c7ec077dd9501a7e0233bbbeb9cdf659795d5be1b4bdcd16bda",
  );
});

test("buildPolicyApprovalRedeemer serializes proof into Aiken shape", async () => {
  const trie = await buildPolicyIndexTrie(FIXTURE_ENTRIES);
  const redeemer = await buildPolicyApprovalRedeemer(trie, FIXTURE_ENTRIES[0]);

  assert.equal(redeemer.policy_id.toString("hex"), FIXTURE_POLICY_ID);
  assert.equal(redeemer.prefix.toString(), "bg_");
  assert.deepEqual(redeemer.flags, { nsfw: 1, trial: 0, aux: 0 });
  assert.equal(redeemer.proof.length, 1);
  assert.ok(redeemer.proof[0].Leaf);
  assert.equal(redeemer.proof[0].Leaf.skip, 0);
  assert.equal(
    redeemer.proof[0].Leaf.key.toString("hex"),
    "dee1e67fa44579fb2c71a029d1e0d2052da47a7cb6ea4dc0c90b07f7835a0e06",
  );
});

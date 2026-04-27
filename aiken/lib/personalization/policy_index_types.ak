use aiken/merkle_patricia_forestry as mpf

// Inline-byte trie root. The on-chain datum at $bg_policy_ids / $pfp_policy_ids
// is just the 32-byte MPF root; we use a named type alias for readability.
pub type PolicyIndexRoot =
  ByteArray

// Per-asset proof carried in the Personalize redeemer's `designer` map under
// reserved keys `__bg_proof` / `__pfp_proof`. The proof asserts the policy is
// registered (with its default nsfw) and either provides a per-asset override
// or proves no override exists for this asset.
//
// policy_id is not carried here. The validator uses the token's policy id
// from the tx output as the trie key, which binds the proof to the asset
// being personalized.
pub type PolicyApprovalProof {
  policy_nsfw: Int,
  policy_proof: mpf.Proof,
  override: Override,
}

pub type Override {
  NoOverride { proof: mpf.Proof }
  WithOverride { nsfw: Int, proof: mpf.Proof }
}

test policy_approval_proof_roundtrip() {
  let proof =
    PolicyApprovalProof {
      policy_nsfw: 0,
      policy_proof: [],
      override: NoOverride { proof: [] },
    }
  let data: Data = proof
  expect decoded: PolicyApprovalProof = data

  decoded == proof
}

test override_roundtrip_with_override() {
  let o = WithOverride { nsfw: 1, proof: [] }
  let data: Data = o
  expect decoded: Override = data

  decoded == o
}

test mpf_insert_and_has_on_empty_proof_vector() {
  let key = "policykey"
  let value = "v"
  let trie = mpf.insert(mpf.empty, key, value, [])

  mpf.has(trie, key, value, [])
}

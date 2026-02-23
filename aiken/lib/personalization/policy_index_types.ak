use aiken/merkle_patricia_forestry as mpf

pub const policy_index_schema_version: Int = 1

pub type PolicyIndexRoot {
  root: ByteArray,
  version: Int,
}

pub type PolicyFlags {
  nsfw: Int,
  trial: Int,
  aux: Int,
}

pub type PolicyApprovalProof {
  policy_id: ByteArray,
  prefix: ByteArray,
  flags: PolicyFlags,
  proof: mpf.Proof,
}

test policy_index_schema_version_is_frozen() {
  policy_index_schema_version == 1
}

test policy_index_root_roundtrip() {
  let root =
    PolicyIndexRoot {
      root: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      version: policy_index_schema_version,
    }
  let data: Data = root
  expect decoded: PolicyIndexRoot = data

  decoded == root
}

test policy_flags_roundtrip() {
  let flags = PolicyFlags { nsfw: 1, trial: 0, aux: 7 }
  let data: Data = flags
  expect decoded: PolicyFlags = data

  decoded == flags
}

test policy_approval_proof_roundtrip() {
  let proof =
    PolicyApprovalProof {
      policy_id: #"010203",
      prefix: "bg_",
      flags: PolicyFlags { nsfw: 1, trial: 1, aux: 0 },
      proof: [],
    }
  let data: Data = proof
  expect decoded: PolicyApprovalProof = data

  decoded == proof
}

test mpf_insert_and_has_on_empty_proof_vector() {
  let key = "policyprefix"
  let value = "flags"
  let trie = mpf.insert(mpf.empty, key, value, [])

  mpf.has(trie, key, value, [])
}

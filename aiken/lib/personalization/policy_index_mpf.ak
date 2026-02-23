use aiken/builtin
use aiken/merkle_patricia_forestry as mpf
use aiken/primitive/bytearray
use personalization/policy_index_types.{
  PolicyApprovalProof, PolicyFlags, PolicyIndexRoot, policy_index_schema_version,
}

pub fn policy_index_key(policy_id: ByteArray, prefix: ByteArray) -> ByteArray {
  bytearray.concat(policy_id, prefix)
}

pub fn encode_policy_flags(flags: PolicyFlags) -> ByteArray {
  bytearray.concat(
    encode_flag(flags.nsfw),
    bytearray.concat(encode_flag(flags.trial), encode_flag(flags.aux)),
  )
}

fn encode_flag(flag: Int) -> ByteArray {
  if flag == 0 {
    #"00"
  } else if flag == 1 {
    #"01"
  } else {
    builtin.serialise_data(flag)
  }
}

pub fn verify_policy_approval(
  root: PolicyIndexRoot,
  token_policy_id: ByteArray,
  token_name: ByteArray,
  approval: PolicyApprovalProof,
) -> Bool {
  if root.version != policy_index_schema_version {
    False
  } else if bytearray.length(root.root) != 32 {
    False
  } else if bytearray.length(token_policy_id) != 28 {
    False
  } else if bytearray.length(approval.policy_id) != 28 {
    False
  } else if token_policy_id != approval.policy_id {
    False
  } else if !bytearray.starts_with(token_name, approval.prefix) {
    False
  } else {
    let key = policy_index_key(approval.policy_id, approval.prefix)
    let value = encode_policy_flags(approval.flags)
    let trie = mpf.from_root(root.root)

    mpf.has(trie, key, value, approval.proof)
  }
}

fn fixture_policy_id() -> ByteArray {
  #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
}

fn fixture_prefix() -> ByteArray {
  "bg_"
}

fn fixture_flags() -> PolicyFlags {
  PolicyFlags { nsfw: 1, trial: 0, aux: 0 }
}

fn fixture_approval() -> PolicyApprovalProof {
  PolicyApprovalProof {
    policy_id: fixture_policy_id(),
    prefix: fixture_prefix(),
    flags: fixture_flags(),
    proof: [],
  }
}

fn fixture_root(approval: PolicyApprovalProof) -> PolicyIndexRoot {
  let trie =
    mpf.insert(
      mpf.empty,
      policy_index_key(approval.policy_id, approval.prefix),
      encode_policy_flags(approval.flags),
      approval.proof,
    )

  PolicyIndexRoot { root: mpf.root(trie), version: policy_index_schema_version }
}

fn fixture_token_name() -> ByteArray {
  bytearray.concat(fixture_prefix(), "mountain")
}

test verify_policy_approval_accepts_valid_bg_proof() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    approval,
  )
}

test verify_policy_approval_rejects_bad_root() {
  let approval = fixture_approval()
  let root =
    PolicyIndexRoot {
      root: #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      version: policy_index_schema_version,
    }

  !verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    approval,
  )
}

test verify_policy_approval_rejects_bad_proof() {
  let approval = fixture_approval()
  let root = fixture_root(approval)
  let bad_proof =
    PolicyApprovalProof {
      policy_id: approval.policy_id,
      prefix: approval.prefix,
      flags: approval.flags,
      proof: [mpf.Leaf { skip: 0, key: "bad", value: "bad" }],
    }

  !verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    bad_proof,
  )
}

test verify_policy_approval_rejects_policy_mismatch() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  !verify_policy_approval(root, #"aaaaaaaa", fixture_token_name(), approval)
}

test verify_policy_approval_rejects_prefix_mismatch() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  !verify_policy_approval(root, fixture_policy_id(), "plain-token", approval)
}

test verify_policy_approval_rejects_flags_mismatch() {
  let approval = fixture_approval()
  let root = fixture_root(approval)
  let wrong_flags =
    PolicyApprovalProof {
      policy_id: approval.policy_id,
      prefix: approval.prefix,
      flags: PolicyFlags { nsfw: 0, trial: 0, aux: 0 },
      proof: approval.proof,
    }

  !verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    wrong_flags,
  )
}

test verify_policy_approval_accepts_valid_pfp_proof() {
  let approval =
    PolicyApprovalProof {
      policy_id: fixture_policy_id(),
      prefix: "pfp_",
      flags: PolicyFlags { nsfw: 0, trial: 1, aux: 0 },
      proof: [],
    }
  let root = fixture_root(approval)
  let token_name = bytearray.concat("pfp_", "portrait")

  verify_policy_approval(root, fixture_policy_id(), token_name, approval)
}

test encode_policy_flags_is_compact_and_stable() {
  and {
    encode_policy_flags(PolicyFlags { nsfw: 1, trial: 0, aux: 7 }) == #"010007",
    encode_policy_flags(PolicyFlags { nsfw: 24, trial: 25, aux: 26 }) == #"18181819181a",
  }
}

test verify_policy_approval_rejects_bad_root_length() {
  let approval = fixture_approval()
  let root =
    PolicyIndexRoot { root: #"aa", version: policy_index_schema_version }

  !verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    approval,
  )
}

test verify_policy_approval_rejects_bad_policy_length() {
  let approval = fixture_approval()
  let root = fixture_root(approval)
  let bad_policy =
    PolicyApprovalProof {
      policy_id: #"aa",
      prefix: approval.prefix,
      flags: approval.flags,
      proof: approval.proof,
    }

  !verify_policy_approval(
    root,
    fixture_policy_id(),
    fixture_token_name(),
    bad_policy,
  )
}

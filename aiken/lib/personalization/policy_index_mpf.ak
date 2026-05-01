use aiken/merkle_patricia_forestry as mpf
use aiken/primitive/bytearray
use personalization/policy_index_types.{
  NoOverride, PolicyApprovalProof, PolicyIndexRoot, WithOverride,
}

fn encode_nsfw(nsfw: Int) -> ByteArray {
  if nsfw == 0 {
    #"00"
  } else {
    #"01"
  }
}

// Verify a per-asset proof package against an MPF root.
// Returns Some(final_nsfw) if valid, None otherwise.
// final_nsfw is the override's nsfw if WithOverride, else the policy default.
pub fn verify_policy_approval(
  root: PolicyIndexRoot,
  token_policy_id: ByteArray,
  token_name: ByteArray,
  approval: PolicyApprovalProof,
) -> Option<Int> {
  let trie = mpf.from_root(root)
  let asset_key = bytearray.concat(token_policy_id, token_name)
  when approval.override is {
    WithOverride { nsfw, proof } ->
      if mpf.has(trie, asset_key, encode_nsfw(nsfw), proof) {
        Some(nsfw)
      } else {
        None
      }
    NoOverride { proof } -> {
      let policy_ok =
        mpf.has(
          trie,
          token_policy_id,
          encode_nsfw(approval.policy_nsfw),
          approval.policy_proof,
        )
      if policy_ok && mpf.miss(trie, asset_key, proof) {
        Some(approval.policy_nsfw)
      } else {
        None
      }
    }
  }
}

// ----- tests: branch-logic only. End-to-end proof correctness against real
// (multi-entry) tries is validated by the off-chain test runner
// (test.js + mpfProofAdapter.js).

fn fixture_policy_id() -> ByteArray {
  #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
}

fn single_entry_root() -> PolicyIndexRoot {
  mpf.root(mpf.insert(mpf.empty, fixture_policy_id(), #"00", []))
}

test rejects_when_policy_nsfw_does_not_match_trie_value() {
  let approval =
    PolicyApprovalProof {
      policy_nsfw: 1,
      policy_proof: [],
      override: NoOverride { proof: [] },
    }

  verify_policy_approval(
    single_entry_root(),
    fixture_policy_id(),
    "any_token",
    approval,
  ) == None
}

test rejects_when_no_override_proof_is_invalid() {
  // Without a real non-membership proof, NoOverride must reject.
  let approval =
    PolicyApprovalProof {
      policy_nsfw: 0,
      policy_proof: [],
      override: NoOverride { proof: [] },
    }

  // Empty trie: from_root with all-zeros has nothing to prove against.
  let empty_root = mpf.root(mpf.empty)

  verify_policy_approval(empty_root, fixture_policy_id(), "x", approval) == None
}

test encode_nsfw_byte_shape() {
  and {
    encode_nsfw(0) == #"00",
    encode_nsfw(1) == #"01",
  }
}

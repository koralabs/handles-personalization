use aiken/merkle_patricia_forestry as mpf
use aiken/primitive/bytearray
use personalization/datum.{AssetClass, empty_asset}
use personalization/policy_index_mpf
use personalization/policy_index_types.{
  PolicyApprovalProof, PolicyFlags, PolicyIndexRoot, policy_index_schema_version,
}

pub type AssetApprovalStatus {
  ApprovalNotRequired
  ApprovalAccepted(PolicyFlags)
  ApprovalRejected
}

pub type DerivedPolicyFlags {
  nsfw: Int,
  trial: Int,
}

pub fn verify_selected_asset(
  root: PolicyIndexRoot,
  asset: AssetClass,
  asset_present_in_output: Bool,
  approval: Option<PolicyApprovalProof>,
) -> AssetApprovalStatus {
  if asset == empty_asset {
    ApprovalNotRequired
  } else if !asset_present_in_output {
    ApprovalRejected
  } else {
    when approval is {
      Some(proof) ->
        if policy_index_mpf.verify_policy_approval(
          root,
          asset.policy_id,
          asset.asset_name,
          proof,
        ) {
          ApprovalAccepted(proof.flags)
        } else {
          ApprovalRejected
        }
      None -> ApprovalRejected
    }
  }
}

pub fn derive_trial_nsfw(
  bg_status: AssetApprovalStatus,
  pfp_status: AssetApprovalStatus,
) -> DerivedPolicyFlags {
  let bg_flags = approval_flags_or_zero(bg_status)
  let pfp_flags = approval_flags_or_zero(pfp_status)
  let nsfw =
    if bg_flags.nsfw + pfp_flags.nsfw > 0 {
      1
    } else {
      0
    }
  let trial =
    if bg_flags.trial + pfp_flags.trial > 0 {
      1
    } else {
      0
    }

  DerivedPolicyFlags { nsfw, trial }
}

pub fn approvals_are_valid(
  bg_status: AssetApprovalStatus,
  pfp_status: AssetApprovalStatus,
) -> Bool {
  status_is_accepted_or_not_required(bg_status) && status_is_accepted_or_not_required(
    pfp_status,
  )
}

pub type PolicyDatumValidationInputs {
  validated_by_present: Bool,
  validated_by_signed: Bool,
  expected_nsfw: Int,
  expected_trial: Int,
  bg_asset_set: Bool,
  pfp_asset_set: Bool,
  bg_image_set: Bool,
  pfp_image_set: Bool,
  bg_image_matches_datum: Bool,
  pfp_image_matches_datum: Bool,
}

pub fn policy_datum_is_valid(
  bg_status: AssetApprovalStatus,
  pfp_status: AssetApprovalStatus,
  inputs: PolicyDatumValidationInputs,
) -> Bool {
  if inputs.validated_by_present && !inputs.validated_by_signed {
    False
  } else if !approvals_are_valid(bg_status, pfp_status) {
    False
  } else if inputs.bg_asset_set != inputs.bg_image_set {
    False
  } else if inputs.pfp_asset_set != inputs.pfp_image_set {
    False
  } else if inputs.bg_asset_set && !inputs.bg_image_matches_datum {
    False
  } else if inputs.pfp_asset_set && !inputs.pfp_image_matches_datum {
    False
  } else {
    let DerivedPolicyFlags { nsfw, trial } =
      derive_trial_nsfw(bg_status, pfp_status)

    nsfw == inputs.expected_nsfw && trial == inputs.expected_trial
  }
}

fn approval_flags_or_zero(status: AssetApprovalStatus) -> PolicyFlags {
  when status is {
    ApprovalAccepted(flags) -> flags
    _ -> PolicyFlags { nsfw: 0, trial: 0, aux: 0 }
  }
}

fn status_is_accepted_or_not_required(status: AssetApprovalStatus) -> Bool {
  when status is {
    ApprovalRejected -> False
    _ -> True
  }
}

fn fixture_policy_id() -> ByteArray {
  #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
}

fn fixture_flags() -> PolicyFlags {
  PolicyFlags { nsfw: 1, trial: 0, aux: 0 }
}

fn fixture_asset() -> AssetClass {
  AssetClass {
    policy_id: fixture_policy_id(),
    asset_name: bytearray.concat("bg_", "mountain"),
  }
}

fn fixture_approval() -> PolicyApprovalProof {
  PolicyApprovalProof {
    policy_id: fixture_policy_id(),
    prefix: "bg_",
    flags: fixture_flags(),
    proof: [],
  }
}

fn fixture_root(approval: PolicyApprovalProof) -> PolicyIndexRoot {
  let trie =
    mpf.insert(
      mpf.empty,
      policy_index_mpf.policy_index_key(approval.policy_id, approval.prefix),
      policy_index_mpf.encode_policy_flags(approval.flags),
      approval.proof,
    )

  PolicyIndexRoot { root: mpf.root(trie), version: policy_index_schema_version }
}

test verify_selected_asset_returns_not_required_for_empty_asset() {
  verify_selected_asset(
    PolicyIndexRoot {
      root: mpf.root(mpf.empty),
      version: policy_index_schema_version,
    },
    empty_asset,
    False,
    None,
  ) == ApprovalNotRequired
}

test verify_selected_asset_rejects_when_asset_not_present() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  verify_selected_asset(root, fixture_asset(), False, Some(approval)) == ApprovalRejected
}

test verify_selected_asset_rejects_missing_proof() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  verify_selected_asset(root, fixture_asset(), True, None) == ApprovalRejected
}

test verify_selected_asset_accepts_valid_proof() {
  let approval = fixture_approval()
  let root = fixture_root(approval)

  verify_selected_asset(root, fixture_asset(), True, Some(approval)) == ApprovalAccepted(
    approval.flags,
  )
}

test verify_selected_asset_rejects_invalid_proof() {
  let approval = fixture_approval()
  let root = fixture_root(approval)
  let wrong_proof =
    PolicyApprovalProof {
      policy_id: approval.policy_id,
      prefix: "pfp_",
      flags: approval.flags,
      proof: approval.proof,
    }

  verify_selected_asset(root, fixture_asset(), True, Some(wrong_proof)) == ApprovalRejected
}

test derive_trial_nsfw_matches_helios_boolean_aggregation() {
  let bg = ApprovalAccepted(PolicyFlags { nsfw: 1, trial: 0, aux: 0 })
  let pfp = ApprovalAccepted(PolicyFlags { nsfw: 0, trial: 1, aux: 0 })

  derive_trial_nsfw(bg, pfp) == DerivedPolicyFlags { nsfw: 1, trial: 1 }
}

test derive_trial_nsfw_defaults_to_zero_without_assets() {
  derive_trial_nsfw(ApprovalNotRequired, ApprovalNotRequired) == DerivedPolicyFlags {
    nsfw: 0,
    trial: 0,
  }
}

test approvals_are_valid_rejects_any_failed_asset() {
  and {
    approvals_are_valid(ApprovalNotRequired, ApprovalAccepted(fixture_flags())),
    !approvals_are_valid(ApprovalRejected, ApprovalAccepted(fixture_flags())),
    !approvals_are_valid(ApprovalAccepted(fixture_flags()), ApprovalRejected),
  }
}

test policy_datum_is_valid_accepts_valid_flags_and_image_rules() {
  let bg_status = ApprovalAccepted(PolicyFlags { nsfw: 1, trial: 0, aux: 0 })
  let pfp_status = ApprovalAccepted(PolicyFlags { nsfw: 0, trial: 1, aux: 0 })

  policy_datum_is_valid(
    bg_status,
    pfp_status,
    PolicyDatumValidationInputs {
      validated_by_present: True,
      validated_by_signed: True,
      expected_nsfw: 1,
      expected_trial: 1,
      bg_asset_set: True,
      pfp_asset_set: True,
      bg_image_set: True,
      pfp_image_set: True,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
  )
}

test policy_datum_is_valid_rejects_unsigned_validated_by() {
  !policy_datum_is_valid(
    ApprovalNotRequired,
    ApprovalNotRequired,
    PolicyDatumValidationInputs {
      validated_by_present: True,
      validated_by_signed: False,
      expected_nsfw: 0,
      expected_trial: 0,
      bg_asset_set: False,
      pfp_asset_set: False,
      bg_image_set: False,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
  )
}

test policy_datum_is_valid_rejects_approval_or_flag_mismatch() {
  and {
    !policy_datum_is_valid(
      ApprovalRejected,
      ApprovalNotRequired,
      PolicyDatumValidationInputs {
        validated_by_present: False,
        validated_by_signed: False,
        expected_nsfw: 0,
        expected_trial: 0,
        bg_asset_set: True,
        pfp_asset_set: False,
        bg_image_set: True,
        pfp_image_set: False,
        bg_image_matches_datum: True,
        pfp_image_matches_datum: True,
      },
    ),
    !policy_datum_is_valid(
      ApprovalAccepted(PolicyFlags { nsfw: 1, trial: 0, aux: 0 }),
      ApprovalNotRequired,
      PolicyDatumValidationInputs {
        validated_by_present: False,
        validated_by_signed: False,
        expected_nsfw: 0,
        expected_trial: 0,
        bg_asset_set: True,
        pfp_asset_set: False,
        bg_image_set: True,
        pfp_image_set: False,
        bg_image_matches_datum: True,
        pfp_image_matches_datum: True,
      },
    ),
  }
}

test policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches() {
  and {
    !policy_datum_is_valid(
      ApprovalNotRequired,
      ApprovalNotRequired,
      PolicyDatumValidationInputs {
        validated_by_present: False,
        validated_by_signed: False,
        expected_nsfw: 0,
        expected_trial: 0,
        bg_asset_set: True,
        pfp_asset_set: False,
        bg_image_set: False,
        pfp_image_set: False,
        bg_image_matches_datum: True,
        pfp_image_matches_datum: True,
      },
    ),
    !policy_datum_is_valid(
      ApprovalNotRequired,
      ApprovalAccepted(PolicyFlags { nsfw: 0, trial: 0, aux: 0 }),
      PolicyDatumValidationInputs {
        validated_by_present: False,
        validated_by_signed: False,
        expected_nsfw: 0,
        expected_trial: 0,
        bg_asset_set: False,
        pfp_asset_set: True,
        bg_image_set: False,
        pfp_image_set: True,
        bg_image_matches_datum: True,
        pfp_image_matches_datum: False,
      },
    ),
  }
}

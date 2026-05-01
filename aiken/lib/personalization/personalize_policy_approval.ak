pub type AssetApprovalStatus {
  ApprovalNotRequired
  Approved { nsfw: Int }
  ApprovalRejected
}

pub fn derive_nsfw(
  bg_status: AssetApprovalStatus,
  pfp_status: AssetApprovalStatus,
) -> Int {
  let bg = nsfw_or_zero(bg_status)
  let pfp = nsfw_or_zero(pfp_status)
  if bg + pfp > 0 {
    1
  } else {
    0
  }
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
    derive_nsfw(bg_status, pfp_status) == inputs.expected_nsfw
  }
}

fn nsfw_or_zero(status: AssetApprovalStatus) -> Int {
  when status is {
    Approved { nsfw } -> nsfw
    _ -> 0
  }
}

fn status_is_accepted_or_not_required(status: AssetApprovalStatus) -> Bool {
  when status is {
    ApprovalRejected -> False
    _ -> True
  }
}

// ----- tests -----

test derive_nsfw_ors_bg_and_pfp() {
  and {
    derive_nsfw(Approved { nsfw: 1 }, Approved { nsfw: 0 }) == 1,
    derive_nsfw(Approved { nsfw: 0 }, Approved { nsfw: 1 }) == 1,
    derive_nsfw(Approved { nsfw: 0 }, Approved { nsfw: 0 }) == 0,
    derive_nsfw(ApprovalNotRequired, ApprovalNotRequired) == 0,
  }
}

test approvals_are_valid_rejects_any_failed_asset() {
  and {
    approvals_are_valid(ApprovalNotRequired, Approved { nsfw: 0 }),
    !approvals_are_valid(ApprovalRejected, Approved { nsfw: 0 }),
    !approvals_are_valid(Approved { nsfw: 0 }, ApprovalRejected),
  }
}

test policy_datum_is_valid_accepts_matching_nsfw_and_image_rules() {
  let bg_status = Approved { nsfw: 1 }
  let pfp_status = Approved { nsfw: 0 }

  policy_datum_is_valid(
    bg_status,
    pfp_status,
    PolicyDatumValidationInputs {
      validated_by_present: True,
      validated_by_signed: True,
      expected_nsfw: 1,
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
      bg_asset_set: False,
      pfp_asset_set: False,
      bg_image_set: False,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
  )
}

test policy_datum_is_valid_rejects_nsfw_mismatch() {
  // bg derived nsfw = 1 but datum expected 0
  !policy_datum_is_valid(
    Approved { nsfw: 1 },
    ApprovalNotRequired,
    PolicyDatumValidationInputs {
      validated_by_present: False,
      validated_by_signed: False,
      expected_nsfw: 0,
      bg_asset_set: True,
      pfp_asset_set: False,
      bg_image_set: True,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
  )
}

test policy_datum_is_valid_rejects_image_set_parity() {
  !policy_datum_is_valid(
    ApprovalNotRequired,
    ApprovalNotRequired,
    PolicyDatumValidationInputs {
      validated_by_present: False,
      validated_by_signed: False,
      expected_nsfw: 0,
      bg_asset_set: True,
      pfp_asset_set: False,
      bg_image_set: False,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
  )
}

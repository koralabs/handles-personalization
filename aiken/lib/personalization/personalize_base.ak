use aiken/primitive/bytearray
use cardano/assets
use personalization/constants
use personalization/types

pub fn datum_name_matches_redeemer(
  datum_name: ByteArray,
  redeemer_name: ByteArray,
) -> Bool {
  bytearray.drop(datum_name, 1) == redeemer_name
}

pub fn handle_label_for_type(handle_type: types.HandleType) -> ByteArray {
  when handle_type is {
    types.HandleTypeVirtualSubhandle -> constants.lbl_000
    _ -> constants.lbl_100
  }
}

pub fn output_has_expected_handle_token(
  output_value: assets.Value,
  handle_type: types.HandleType,
  handle_name: ByteArray,
) -> Bool {
  let token_name =
    bytearray.concat(handle_label_for_type(handle_type), handle_name)

  assets.quantity_of(output_value, constants.handle_policy_id, token_name) == 1
}

pub fn resolved_ada_is_allowed(handle_type: types.HandleType) -> Bool {
  handle_type == types.HandleTypeVirtualSubhandle
}

pub fn subhandle_personalization_is_allowed(
  handle_type: types.HandleType,
  reset: Bool,
  sub_pz_enabled: Bool,
  root_pz_enabled: Bool,
  new_pz_enabled: Bool,
) -> Bool {
  let root_gate_ok =
    handle_type == types.HandleTypeHandle || reset || sub_pz_enabled || root_pz_enabled
  let pz_enabled_gate_ok =
    handle_type == types.HandleTypeHandle || sub_pz_enabled || root_pz_enabled && new_pz_enabled

  root_gate_ok && pz_enabled_gate_ok
}

pub fn immutables_are_unchanged(
  standard_image_unchanged: Bool,
  standard_image_hash_unchanged: Bool,
  original_address_unchanged: Bool,
  immutable_nft_fields_unchanged: Bool,
  agreed_terms_is_set: Bool,
) -> Bool {
  standard_image_unchanged && standard_image_hash_unchanged && original_address_unchanged && immutable_nft_fields_unchanged && agreed_terms_is_set
}

pub fn non_reset_authorization_is_valid(
  designed: Bool,
  designer_changed: Bool,
  required_asset_valid: Bool,
  fees_paid: Bool,
  designer_settings_valid: Bool,
  is_reset_shape: Bool,
) -> Bool {
  if designed && designer_changed {
    required_asset_valid && fees_paid && designer_settings_valid
  } else {
    designed || is_reset_shape
  }
}

pub type ResetPrivacyInputs {
  holder_changed: Bool,
  signed_by_provider: Bool,
  signed_by_owner: Bool,
  socials_cleared: Bool,
  resolved_addresses_cleared: Bool,
  socials_unchanged: Bool,
  resolved_addresses_unchanged: Bool,
}

pub fn reset_privacy_is_valid(inputs: ResetPrivacyInputs) -> Bool {
  if inputs.holder_changed {
    inputs.socials_cleared && inputs.resolved_addresses_cleared
  } else {
    inputs.signed_by_provider || inputs.signed_by_owner || inputs.socials_unchanged && inputs.resolved_addresses_unchanged
  }
}

pub fn reset_authorization_is_valid(
  designer_assets_valid: Bool,
  required_assets_valid: Bool,
  signed_by_provider: Bool,
  signed_by_owner: Bool,
  is_reset_shape: Bool,
  unchanged_when_reset_denied: Bool,
) -> Bool {
  if !designer_assets_valid || !required_assets_valid || signed_by_provider || signed_by_owner {
    is_reset_shape
  } else {
    unchanged_when_reset_denied
  }
}

pub fn shared_subhandle_fee(
  pz_min_fee: Int,
  subhandle_share_percent: Int,
) -> Int {
  if subhandle_share_percent == 0 {
    0
  } else {
    pz_min_fee / ( 100 / subhandle_share_percent )
  }
}

pub type FeeValidationInputs {
  within_grace_period: Bool,
  treasury_fee_paid: Bool,
  provider_fee_paid: Bool,
  is_subhandle: Bool,
  root_fee_paid: Bool,
}

pub fn fees_are_paid(inputs: FeeValidationInputs) -> Bool {
  if inputs.within_grace_period {
    True
  } else if !inputs.treasury_fee_paid {
    False
  } else if !inputs.provider_fee_paid {
    False
  } else {
    !inputs.is_subhandle || inputs.root_fee_paid
  }
}

test datum_name_matches_redeemer_drops_label_byte() {
  and {
    datum_name_matches_redeemer("0alice", "alice"),
    !datum_name_matches_redeemer("0alice", "bob"),
  }
}

test handle_label_for_type_matches_helios_branching() {
  and {
    handle_label_for_type(types.HandleTypeHandle) == constants.lbl_100,
    handle_label_for_type(types.HandleTypeNftSubhandle) == constants.lbl_100,
    handle_label_for_type(types.HandleTypeVirtualSubhandle) == constants.lbl_000,
  }
}

test output_has_expected_handle_token_checks_policy_and_label() {
  let handle_name = "alice"
  let handle_token =
    assets.from_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_100, handle_name),
      1,
    )
  let virtual_token =
    assets.from_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_000, handle_name),
      1,
    )

  and {
    output_has_expected_handle_token(
      handle_token,
      types.HandleTypeHandle,
      handle_name,
    ),
    output_has_expected_handle_token(
      handle_token,
      types.HandleTypeNftSubhandle,
      handle_name,
    ),
    output_has_expected_handle_token(
      virtual_token,
      types.HandleTypeVirtualSubhandle,
      handle_name,
    ),
    !output_has_expected_handle_token(
      handle_token,
      types.HandleTypeVirtualSubhandle,
      handle_name,
    ),
  }
}

test resolved_ada_is_allowed_only_for_virtual_subhandles() {
  and {
    !resolved_ada_is_allowed(types.HandleTypeHandle),
    !resolved_ada_is_allowed(types.HandleTypeNftSubhandle),
    resolved_ada_is_allowed(types.HandleTypeVirtualSubhandle),
  }
}

test subhandle_personalization_is_allowed_matches_helios_gates() {
  and {
    subhandle_personalization_is_allowed(
      types.HandleTypeHandle,
      False,
      False,
      False,
      False,
    ),
    subhandle_personalization_is_allowed(
      types.HandleTypeNftSubhandle,
      True,
      True,
      False,
      True,
    ),
    subhandle_personalization_is_allowed(
      types.HandleTypeNftSubhandle,
      False,
      True,
      False,
      False,
    ),
    subhandle_personalization_is_allowed(
      types.HandleTypeNftSubhandle,
      False,
      False,
      True,
      True,
    ),
    !subhandle_personalization_is_allowed(
      types.HandleTypeNftSubhandle,
      False,
      False,
      False,
      False,
    ),
    !subhandle_personalization_is_allowed(
      types.HandleTypeNftSubhandle,
      False,
      False,
      True,
      False,
    ),
  }
}

test immutables_are_unchanged_requires_all_immutable_checks() {
  and {
    immutables_are_unchanged(True, True, True, True, True),
    !immutables_are_unchanged(False, True, True, True, True),
    !immutables_are_unchanged(True, False, True, True, True),
    !immutables_are_unchanged(True, True, False, True, True),
    !immutables_are_unchanged(True, True, True, False, True),
    !immutables_are_unchanged(True, True, True, True, False),
  }
}

test non_reset_authorization_is_valid_matches_designer_branches() {
  and {
    non_reset_authorization_is_valid(True, True, True, True, True, False),
    !non_reset_authorization_is_valid(True, True, False, True, True, False),
    !non_reset_authorization_is_valid(True, True, True, False, True, False),
    !non_reset_authorization_is_valid(True, True, True, True, False, False),
    non_reset_authorization_is_valid(True, False, False, False, False, False),
    non_reset_authorization_is_valid(False, False, False, False, False, True),
    !non_reset_authorization_is_valid(False, False, False, False, False, False),
  }
}

test reset_privacy_is_valid_matches_holder_change_requirements() {
  and {
    reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: True,
        signed_by_provider: False,
        signed_by_owner: False,
        socials_cleared: True,
        resolved_addresses_cleared: True,
        socials_unchanged: False,
        resolved_addresses_unchanged: False,
      },
    ),
    !reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: True,
        signed_by_provider: False,
        signed_by_owner: False,
        socials_cleared: False,
        resolved_addresses_cleared: True,
        socials_unchanged: False,
        resolved_addresses_unchanged: False,
      },
    ),
    reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: False,
        signed_by_provider: True,
        signed_by_owner: False,
        socials_cleared: False,
        resolved_addresses_cleared: False,
        socials_unchanged: False,
        resolved_addresses_unchanged: False,
      },
    ),
    reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: False,
        signed_by_provider: False,
        signed_by_owner: True,
        socials_cleared: False,
        resolved_addresses_cleared: False,
        socials_unchanged: False,
        resolved_addresses_unchanged: False,
      },
    ),
    reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: False,
        signed_by_provider: False,
        signed_by_owner: False,
        socials_cleared: False,
        resolved_addresses_cleared: False,
        socials_unchanged: True,
        resolved_addresses_unchanged: True,
      },
    ),
    !reset_privacy_is_valid(
      ResetPrivacyInputs {
        holder_changed: False,
        signed_by_provider: False,
        signed_by_owner: False,
        socials_cleared: False,
        resolved_addresses_cleared: False,
        socials_unchanged: True,
        resolved_addresses_unchanged: False,
      },
    ),
  }
}

test reset_authorization_is_valid_matches_helios_reset_rules() {
  and {
    reset_authorization_is_valid(False, True, False, False, True, False),
    reset_authorization_is_valid(True, False, False, False, True, False),
    reset_authorization_is_valid(True, True, True, False, True, False),
    reset_authorization_is_valid(True, True, False, True, True, False),
    !reset_authorization_is_valid(False, True, False, False, False, False),
    reset_authorization_is_valid(True, True, False, False, False, True),
    !reset_authorization_is_valid(True, True, False, False, False, False),
  }
}

test shared_subhandle_fee_matches_helios_formula() {
  and {
    shared_subhandle_fee(0, 25) == 0,
    shared_subhandle_fee(1000000, 0) == 0,
    shared_subhandle_fee(1000000, 25) == 250000,
    shared_subhandle_fee(1000000, 20) == 200000,
  }
}

test fees_are_paid_matches_grace_and_payment_rules() {
  and {
    fees_are_paid(
      FeeValidationInputs {
        within_grace_period: True,
        treasury_fee_paid: False,
        provider_fee_paid: False,
        is_subhandle: True,
        root_fee_paid: False,
      },
    ),
    !fees_are_paid(
      FeeValidationInputs {
        within_grace_period: False,
        treasury_fee_paid: False,
        provider_fee_paid: True,
        is_subhandle: False,
        root_fee_paid: False,
      },
    ),
    !fees_are_paid(
      FeeValidationInputs {
        within_grace_period: False,
        treasury_fee_paid: True,
        provider_fee_paid: False,
        is_subhandle: False,
        root_fee_paid: False,
      },
    ),
    fees_are_paid(
      FeeValidationInputs {
        within_grace_period: False,
        treasury_fee_paid: True,
        provider_fee_paid: True,
        is_subhandle: False,
        root_fee_paid: False,
      },
    ),
    !fees_are_paid(
      FeeValidationInputs {
        within_grace_period: False,
        treasury_fee_paid: True,
        provider_fee_paid: True,
        is_subhandle: True,
        root_fee_paid: False,
      },
    ),
    fees_are_paid(
      FeeValidationInputs {
        within_grace_period: False,
        treasury_fee_paid: True,
        provider_fee_paid: True,
        is_subhandle: True,
        root_fee_paid: True,
      },
    ),
  }
}

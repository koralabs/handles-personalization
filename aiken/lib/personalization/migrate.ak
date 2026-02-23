pub fn migrate_is_valid(
  datums_unchanged: Bool,
  output_has_expected_handle_token: Bool,
  output_contract_is_valid: Bool,
  migration_signers_valid: Bool,
) -> Bool {
  datums_unchanged && output_has_expected_handle_token && output_contract_is_valid && migration_signers_valid
}

pub fn migration_signers_are_valid(
  admin_signed: Bool,
  owner_sig_required: Bool,
  owner_token_present: Bool,
) -> Bool {
  admin_signed && ( !owner_sig_required || owner_token_present )
}

test migrate_is_valid_accepts_all_required_conditions() {
  migrate_is_valid(True, True, True, True)
}

test migrate_is_valid_rejects_changed_datum() {
  !migrate_is_valid(False, True, True, True)
}

test migrate_is_valid_rejects_wrong_output_token() {
  !migrate_is_valid(True, False, True, True)
}

test migrate_is_valid_rejects_invalid_contract_or_signer() {
  and {
    !migrate_is_valid(True, True, False, True),
    !migrate_is_valid(True, True, True, False),
  }
}

test migration_signers_are_valid_matches_admin_and_owner_rules() {
  and {
    migration_signers_are_valid(True, False, False),
    migration_signers_are_valid(True, True, True),
    !migration_signers_are_valid(False, False, False),
    !migration_signers_are_valid(False, True, True),
    !migration_signers_are_valid(True, True, False),
  }
}

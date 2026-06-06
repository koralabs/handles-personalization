use personalization/types

// DSH-301 — nft/root burn authorization.
//
// The pz proxy holds every handle's LBL_100 reference token. Burning an nft/root handle releases
// (and destroys) that held 100. Authorization mirrors mint: you can only burn the 100 if you ALSO
// burn the matching 222 you hold (owner consent), and the handle's policy must be in the on-chain
// `$handle_policies` registry (so DeMi-policy handles can burn, not just legacy f0ff48bb). Virtual
// subs are NOT burned this way — they use Revoke (private = root-signed, public = lease-expired).
pub fn burn_is_valid(
  handle_type: types.HandleType,
  policy_registered: Bool,
  ref_token_burned: Bool,
  owner_token_burned: Bool,
) -> Bool {
  // nft/root only — a virtual sub has no user-held 222, so it can never satisfy owner_token_burned
  // anyway, but gate explicitly so Revoke stays the only virtual-burn path.
  let is_nft_or_root =
    handle_type == types.HandleTypeHandle || handle_type == types.HandleTypeNftSubhandle
  and {
    is_nft_or_root,
    policy_registered,
    ref_token_burned,
    owner_token_burned,
  }
}

test burn_is_valid_accepts_root_with_consent_and_registered_policy() {
  burn_is_valid(types.HandleTypeHandle, True, True, True)
}

test burn_is_valid_accepts_nft_sub_with_consent_and_registered_policy() {
  burn_is_valid(types.HandleTypeNftSubhandle, True, True, True)
}

test burn_is_valid_rejects_unregistered_policy() {
  !burn_is_valid(types.HandleTypeHandle, False, True, True)
}

test burn_is_valid_rejects_without_owner_consent() {
  // 222 not burned -> no owner consent -> the held 100 must not be released
  !burn_is_valid(types.HandleTypeHandle, True, True, False)
}

test burn_is_valid_rejects_without_ref_token_burn() {
  // the released 100 must be destroyed, never redirected
  !burn_is_valid(types.HandleTypeHandle, True, False, True)
}

test burn_is_valid_rejects_virtual_handles() {
  !burn_is_valid(types.HandleTypeVirtualSubhandle, True, True, True)
}

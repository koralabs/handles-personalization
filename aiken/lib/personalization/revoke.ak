use personalization/types

pub fn revoke_is_valid(
  handle_type: types.HandleType,
  public_mint: Bool,
  root_signed: Bool,
  expired: Bool,
  // DSH-303: the virtual sub's 000 is burned (-1) under the legacy OR a $handle_policies-registered
  // policy — the caller resolves this (decentralized), so DeMi virtual subs can be revoked too.
  token_burned: Bool,
) -> Bool {
  if handle_type != types.HandleTypeVirtualSubhandle {
    False
  } else {
    ( !public_mint && root_signed || public_mint && expired ) && token_burned
  }
}

test revoke_is_valid_accepts_private_root_signed_revoke() {
  revoke_is_valid(types.HandleTypeVirtualSubhandle, False, True, False, True)
}

test revoke_is_valid_accepts_public_expired_revoke() {
  revoke_is_valid(types.HandleTypeVirtualSubhandle, True, False, True, True)
}

test revoke_is_valid_rejects_public_not_expired() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, True, False, False, True)
}

test revoke_is_valid_rejects_private_without_root_signature() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, False, False, False, True)
}

test revoke_is_valid_rejects_non_virtual_handles() {
  and {
    !revoke_is_valid(types.HandleTypeHandle, False, True, True, True),
    !revoke_is_valid(types.HandleTypeNftSubhandle, False, True, True, True),
  }
}

test revoke_is_valid_rejects_when_token_not_burned() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, False, True, False, False)
}

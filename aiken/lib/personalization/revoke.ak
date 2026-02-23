use personalization/types

pub fn revoke_is_valid(
  handle_type: types.HandleType,
  public_mint: Bool,
  root_signed: Bool,
  expired: Bool,
  minted_quantity: Int,
) -> Bool {
  if handle_type != types.HandleTypeVirtualSubhandle {
    False
  } else {
    ( !public_mint && root_signed || public_mint && expired ) && minted_quantity == -1
  }
}

test revoke_is_valid_accepts_private_root_signed_revoke() {
  revoke_is_valid(types.HandleTypeVirtualSubhandle, False, True, False, -1)
}

test revoke_is_valid_accepts_public_expired_revoke() {
  revoke_is_valid(types.HandleTypeVirtualSubhandle, True, False, True, -1)
}

test revoke_is_valid_rejects_public_not_expired() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, True, False, False, -1)
}

test revoke_is_valid_rejects_private_without_root_signature() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, False, False, False, -1)
}

test revoke_is_valid_rejects_non_virtual_handles() {
  and {
    !revoke_is_valid(types.HandleTypeHandle, False, True, True, -1),
    !revoke_is_valid(types.HandleTypeNftSubhandle, False, True, True, -1),
  }
}

test revoke_is_valid_rejects_invalid_mint_quantity() {
  !revoke_is_valid(types.HandleTypeVirtualSubhandle, False, True, False, 0)
}

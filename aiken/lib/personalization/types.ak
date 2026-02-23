pub type DataMap =
  Pairs<ByteArray, Data>

pub type IntMatrix =
  List<List<Int>>

pub type HandleType {
  HandleTypeHandle
  HandleTypeNftSubhandle
  HandleTypeVirtualSubhandle
}

pub type Handle {
  handle_type: HandleType,
  name: ByteArray,
}

pub type PzIndexes {
  pfp_approver: Int,
  bg_approver: Int,
  pfp_datum: Int,
  bg_datum: Int,
  required_asset: Int,
  owner_settings: Int,
  contract_output: Int,
  pz_assets: Int,
  provider_fee: Int,
}

pub type VirtIndexes {
  admin_settings: Int,
  root_settings: Int,
  contract_output: Int,
  root_handle: Int,
}

pub type Redeemer {
  Personalize {
    handle: Handle,
    root_handle: ByteArray,
    indexes: PzIndexes,
    designer: DataMap,
    reset: Int,
  }
  Migrate { handle: Handle, output_index: Int }
  Revoke { handle: Handle, root_handle: ByteArray, owner_index: Int }
  Update { handle: Handle, root_handle: ByteArray, indexes: VirtIndexes }
  ReturnToSender
}

pub type MainSubHandleSettings {
  valid_contracts: List<ByteArray>,
  admin_creds: List<ByteArray>,
  virtual_price: Int,
  base_price: Int,
  buy_down_prices: IntMatrix,
  payment_address: ByteArray,
  expiry_duration: Int,
  renewal_window: Int,
}

pub type SubHandleSettings {
  public_minting_enabled: Int,
  pz_enabled: Int,
  tier_pricing: IntMatrix,
  default_styles: Data,
  save_original_address: Int,
}

pub type OwnerSettings {
  nft: SubHandleSettings,
  virtual: SubHandleSettings,
  buy_down_price: Int,
  buy_down_paid: Int,
  buy_down_percent: Int,
  agreed_terms: Data,
  migrate_sig_required: Int,
  payment_address: ByteArray,
}

pub type PzSettings {
  treasury_fee: Int,
  treasury_cred: ByteArray,
  pz_min_fee: Int,
  pz_providers: Pairs<ByteArray, ByteArray>,
  valid_contracts: List<ByteArray>,
  admin_creds: List<ByteArray>,
  settings_cred: ByteArray,
  grace_period: Int,
  subhandle_share_percent: Int,
}

pub type FontShadowSize {
  x: Int,
  y: Int,
  blur: Int,
}

pub type PfpOffset {
  x: Int,
  y: Int,
}

pub type PersonalizationDatum {
  Cip68 { nft: DataMap, version: Int, extra: Data }
}

test handle_type_variants_are_distinct() {
  and {
    HandleTypeHandle != HandleTypeNftSubhandle,
    HandleTypeNftSubhandle != HandleTypeVirtualSubhandle,
    HandleTypeHandle != HandleTypeVirtualSubhandle,
  }
}

test migrate_redeemer_is_constructible() {
  let handle = Handle { handle_type: HandleTypeHandle, name: "alice" }

  Migrate { handle, output_index: 0 } == Migrate { handle, output_index: 0 }
}

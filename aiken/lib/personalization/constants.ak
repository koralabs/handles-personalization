use aiken/primitive/bytearray
use cardano/assets

pub const handle_hash: ByteArray =
  #"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"

pub const handle_policy_id: assets.PolicyId = handle_hash

pub const lbl_444: ByteArray = #"001bc280"

pub const lbl_222: ByteArray = #"000de140"

pub const lbl_100: ByteArray = #"000643b0"

pub const lbl_001: ByteArray = #"00001070"

pub const lbl_000: ByteArray = #"00000000"

pub const pz_handle_asset_name: assets.AssetName =
  bytearray.concat(lbl_222, "pz_settings")

pub const agreed_terms: String = @"https://handle.me/$/tou"

pub fn prefixed_asset_name(prefix: ByteArray, suffix: ByteArray) -> ByteArray {
  bytearray.concat(prefix, suffix)
}

test handle_constants_match_helios() {
  and {
    handle_hash == #"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a",
    handle_policy_id == handle_hash,
    lbl_444 == #"001bc280",
    lbl_222 == #"000de140",
    lbl_100 == #"000643b0",
    lbl_001 == #"00001070",
    lbl_000 == #"00000000",
    pz_handle_asset_name == #"000de140707a5f73657474696e6773",
    agreed_terms == @"https://handle.me/$/tou",
  }
}

test prefixed_asset_name_matches_helios_concatenation() {
  prefixed_asset_name(lbl_001, "root") == #"00001070726f6f74"
}

use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets
use personalization/constants

pub fn value_has_forbidden_handle_assets(value: assets.Value) -> Bool {
  list.any(
    assets.flatten(value),
    fn(entry) {
      let (policy_id, asset_name, _) = entry
      policy_id == constants.handle_policy_id && (
        bytearray.starts_with(asset_name, constants.lbl_100) || bytearray.starts_with(
          asset_name,
          constants.lbl_001,
        )
      )
    },
  )
}

pub fn return_to_sender_is_valid(
  output_values: List<assets.Value>,
  admin_signed: Bool,
) -> Bool {
  admin_signed && !list.any(output_values, value_has_forbidden_handle_assets)
}

fn value_with_asset(policy_id: ByteArray, asset_name: ByteArray) -> assets.Value {
  assets.from_asset(policy_id, asset_name, 1)
}

test value_has_forbidden_handle_assets_detects_lbl_100() {
  value_has_forbidden_handle_assets(
    value_with_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_100, "alice"),
    ),
  )
}

test value_has_forbidden_handle_assets_detects_lbl_001() {
  value_has_forbidden_handle_assets(
    value_with_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_001, "alice"),
    ),
  )
}

test value_has_forbidden_handle_assets_ignores_other_assets() {
  and {
    !value_has_forbidden_handle_assets(
      value_with_asset(
        constants.handle_policy_id,
        bytearray.concat(constants.lbl_222, "safe"),
      ),
    ),
    !value_has_forbidden_handle_assets(
      value_with_asset(
        #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bytearray.concat(constants.lbl_100, "alice"),
      ),
    ),
  }
}

test return_to_sender_is_valid_requires_admin_signature() {
  !return_to_sender_is_valid([assets.zero], False)
}

test return_to_sender_is_valid_rejects_forbidden_assets_in_any_output() {
  let safe =
    value_with_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_222, "safe"),
    )
  let forbidden =
    value_with_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_100, "alice"),
    )

  !return_to_sender_is_valid([safe, forbidden], True)
}

test return_to_sender_is_valid_accepts_safe_outputs() {
  let safe_1 =
    value_with_asset(
      constants.handle_policy_id,
      bytearray.concat(constants.lbl_222, "safe"),
    )
  let safe_2 =
    value_with_asset(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bytearray.concat(constants.lbl_100, "alice"),
    )

  return_to_sender_is_valid([safe_1, safe_2], True)
}

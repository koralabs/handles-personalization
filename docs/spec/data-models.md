# Data Models

## Redeemer Variants

### `PERSONALIZE`
- `handle: Handle` (`type`, `name`)
- `root_handle: ByteArray`
- `indexes: PzIndexes`
- `designer: Map[String]Data`
- `reset: Int` (`0|1`)

### `MIGRATE`
- `handle: Handle`
- `output_index: Int`

### `REVOKE`
- `handle: Handle`
- `root_handle: ByteArray`
- `owner_index: Int`

### `UPDATE`
- `handle: Handle`
- `root_handle: ByteArray`
- `indexes: VirtIndexes`

### `RETURN_TO_SENDER`
- no fields

## Index Structures

### `PzIndexes`
- `pfp_approver`
- `bg_approver`
- `pfp_datum`
- `bg_datum`
- `required_asset`
- `owner_settings`
- `contract_output`
- `pz_assets`
- `provider_fee`

### `VirtIndexes`
- `admin_settings`
- `root_settings`
- `contract_output`
- `root_handle`

## Settings Data

### `PzSettings`
- `treasury_fee: Int`
- `treasury_cred: ByteArray`
- `pz_min_fee: Int`
- `pz_providers: Map[ByteArray]ByteArray`
- `valid_contracts: []ByteArray`
- `admin_creds: []ByteArray`
- `settings_cred: ByteArray`
- `grace_period: Int`
- `subhandle_share_percent: Int`

### `MainSubHandleSettings`
- `valid_contracts`
- `admin_creds`
- `virtual_price`
- `base_price`
- `buy_down_prices`
- `payment_address`
- `expiry_duration`
- `renewal_window`

### `OwnerSettings`
- `nft: SubHandleSettings`
- `virtual: SubHandleSettings`
- `buy_down_price`
- `buy_down_paid`
- `buy_down_percent`
- `agreed_terms`
- `migrate_sig_required`
- `payment_address`

### `SubHandleSettings`
- `public_minting_enabled`
- `pz_enabled`
- `tier_pricing`
- `default_styles`
- `save_original_address`

## Datum

### `Datum::CIP68`
- `nft: Map[String]Data`
- `version: Int`
- `extra: Data`

### Expected `extra` keys (observed by validator)
- core integrity:
  - `image_hash`, `standard_image`, `standard_image_hash`, `agreed_terms`
- personalization state:
  - `bg_asset`, `pfp_asset`, `bg_image`, `pfp_image`, `designer`
  - `nsfw`, `trial`, `portal`, `socials`, `last_update_address`, `validated_by`
- optional controls:
  - `pz_enabled`, `last_edited_time`, `migrate_sig_required`
  - `resolved_addresses` (virtual path)
  - `virtual` map (`public_mint`, `expires_time`) for virtual subhandles

## Token/Label Constants
- Handle policy: `HANDLE_POLICY = #f0ff48...fb9a`
- Labels:
  - `LBL_444 = #001bc280`
  - `LBL_222 = #000de140`
  - `LBL_100 = #000643b0`
  - `LBL_001 = #00001070`
  - `LBL_000 = #00000000`

## Invariant Types
- `FontShadowSize { x, y, blur }`
- `PfpOffset { x, y }`

## Data Access Semantics
- `get_extra(extra: Data)` accepts map-like and constructor tuple forms; defaults to empty map.
- `get_datum(output_datum, tx.datums)` supports inline/hash datum resolution with `EMPTY_DATA` fallback.
- Optional field checks use `has_value_unwrapped` to normalize empty/none semantics.

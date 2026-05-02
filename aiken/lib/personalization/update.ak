use aiken/builtin
use aiken/collection/list
use aiken/interval
use aiken/option
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction
use personalization/constants
use personalization/datum
use personalization/designer_settings
use personalization/migrate
use personalization/personalize_base
use personalization/personalize_mpf_context
use personalization/personalize_policy_approval
use personalization/return_to_sender
use personalization/revoke
use personalization/types
use personalization/utils

pub type UpdateValidationInputs {
  handle_type: types.HandleType,
  protocol_settings_present: Bool,
  root_settings_present: Bool,
  pz_payload_unchanged: Bool,
  nft_unchanged: Bool,
  public_mint: Bool,
  root_signed: Bool,
  expired: Bool,
  address_changed: Bool,
  address_change_stake_approved: Bool,
  assignee_signed_pay: Bool,
  assignee_signed_stake: Bool,
  extended: Bool,
  expiry_unchanged: Bool,
  good_main_payment: Bool,
  good_root_payment: Bool,
  admin_signed: Bool,
  new_public_mint_is_private: Bool,
  root_virtual_mint_enabled: Bool,
}

pub fn update_is_valid(inputs: UpdateValidationInputs) -> Bool {
  if inputs.handle_type != types.HandleTypeVirtualSubhandle {
    False
  } else if !inputs.protocol_settings_present || !inputs.root_settings_present {
    False
  } else if !inputs.pz_payload_unchanged || !inputs.nft_unchanged {
    False
  } else if !inputs.public_mint && inputs.root_signed {
    inputs.address_changed || inputs.extended && (
      inputs.good_main_payment || inputs.admin_signed
    )
  } else if inputs.public_mint && inputs.root_signed && inputs.expired {
    inputs.extended && inputs.good_main_payment && inputs.new_public_mint_is_private
  } else if
  inputs.assignee_signed_pay || inputs.assignee_signed_stake {
    let addr_change_ok =
      !inputs.address_changed || inputs.address_change_stake_approved && inputs.assignee_signed_stake

    addr_change_ok && (
      inputs.extended && inputs.good_main_payment && inputs.good_root_payment || inputs.expiry_unchanged
    ) && inputs.root_virtual_mint_enabled
  } else {
    False
  }
}

const key_virtual: ByteArray = "virtual"

const key_public_mint: ByteArray = "public_mint"

const key_expires_time: ByteArray = "expires_time"

const key_resolved_addresses: ByteArray = "resolved_addresses"

const key_ada: ByteArray = "ada"

const key_migrate_sig_required: ByteArray = "migrate_sig_required"

const key_bg_asset: ByteArray = "bg_asset"

const key_pfp_asset: ByteArray = "pfp_asset"

const key_designer: ByteArray = "designer"

const key_name: ByteArray = "name"

const key_policy_ids_bg: ByteArray = "bg_policy_ids"

const key_policy_ids_pfp: ByteArray = "pfp_policy_ids"

const key_bg_proof: ByteArray = "__bg_proof"

const key_pfp_proof: ByteArray = "__pfp_proof"

const key_last_update_address: ByteArray = "last_update_address"

const key_pz_enabled: ByteArray = "pz_enabled"

const key_image: ByteArray = "image"

const key_image_hash: ByteArray = "image_hash"

const key_standard_image: ByteArray = "standard_image"

const key_standard_image_hash: ByteArray = "standard_image_hash"

const key_original_address: ByteArray = "original_address"

const key_agreed_terms: ByteArray = "agreed_terms"

const key_trial: ByteArray = "trial"

const key_nsfw: ByteArray = "nsfw"

const key_socials: ByteArray = "socials"

const key_last_edited_time: ByteArray = "last_edited_time"

const key_pfp_image: ByteArray = "pfp_image"

const key_bg_image: ByteArray = "bg_image"

const key_force_creator_settings: ByteArray = "force_creator_settings"

// Keys whose values must be unchanged between old and new extra when reset
// is denied (Helios immutables_are_unchanged equivalent for the personalize
// reset-denied path). Hoisted to a module const so the list isn't allocated
// per-validator-call.
const immutable_extra_keys: List<ByteArray> =
  [
    key_image_hash, key_pfp_asset, key_bg_asset, key_pfp_image, key_bg_image,
    key_designer, key_trial, key_nsfw,
  ]

// Standard immutable keys whose values must match between old and new extra
// in the immutables_are_unchanged check (always-required, regardless of reset).
const standard_unchanged_keys: List<ByteArray> =
  [key_standard_image, key_standard_image_hash, key_original_address]

// Hash of the `persdsg` (designer-settings observer) validator. perspz
// requires this observer to fire for non-reset Personalize txs — it
// validates designer_settings_are_valid on perspz's behalf, letting perspz
// drop ~2,800 bytes of validation logic.
//
// IMPORTANT: this hash is determined at deploy time. If `persdsg.ak` or any
// transitively-reachable code changes, this hash will change too — rebuild
// persdsg, copy the new hash from `plutus.json` (`validators[].hash`), and
// update the const here, then rebuild perspz.
const persdsg_hash: ByteArray =
  #"a8c1ca7158a4a641e322bd66214875dbfc9c7857255031923923c356"

fn output_data(
  output: transaction.Output,
  tx: transaction.Transaction,
) -> Option<Data> {
  datum.get_datum_opt(output.datum, tx)
}

// Helios-era pz_settings on-chain datum is a 9-element raw List<Data>, not
// an Aiken Constr 0 record. The legacy Helios `struct PzSettings { ... }`
// serializes to PlutusData::List, while Aiken's `pub type PzSettings { x: ... }`
// expects PlutusData::Constr 0. So `expect settings: types.PzSettings = settings_data`
// fails with `unConstrData` when settings_data is the on-chain List form.
//
// Parse the list manually instead, preserving the order of the legacy
// Helios struct fields. Order verified against pz_settings@handle_settings
// on preview as of 2026-04-29 (LBL_222 of pz_settings, datum starts `89...`
// = CBOR array(9)).

fn parse_pz_settings_from_list(settings_data: Data) -> types.PzSettings {
  expect [
    treasury_fee_data,
    treasury_cred_data,
    pz_min_fee_data,
    pz_providers_data,
    valid_contracts_data,
    admin_creds_data,
    settings_cred_data,
    grace_period_data,
    subhandle_share_percent_data,
  ]: List<Data> = settings_data
  expect treasury_fee: Int = treasury_fee_data
  expect treasury_cred: ByteArray = treasury_cred_data
  expect pz_min_fee: Int = pz_min_fee_data
  expect pz_providers: Pairs<ByteArray, ByteArray> = pz_providers_data
  expect valid_contracts: List<ByteArray> = valid_contracts_data
  expect admin_creds: List<ByteArray> = admin_creds_data
  expect settings_cred: ByteArray = settings_cred_data
  expect grace_period: Int = grace_period_data
  expect subhandle_share_percent: Int = subhandle_share_percent_data
  types.PzSettings {
    treasury_fee,
    treasury_cred,
    pz_min_fee,
    pz_providers,
    valid_contracts,
    admin_creds,
    settings_cred,
    grace_period,
    subhandle_share_percent,
  }
}

// Perspz-only lean loader: finds the PZ settings ref input, validates the
// credential, and returns the 7 fields the personalize path needs as a tuple
// — bypassing construction of the full 9-field PzSettings record. Reduces
// perspz binary by avoiding both the record allocation and the unused
// admin_creds field cast.
fn load_pz_settings_for_personalize(
  tx: transaction.Transaction,
) -> Option<
  (
    Int,
    ByteArray,
    Int,
    Pairs<ByteArray, ByteArray>,
    List<ByteArray>,
    ByteArray,
    Int,
    Int,
  ),
> {
  when
    list.find(
      tx.reference_inputs,
      fn(input) {
        assets.quantity_of(
          input.output.value,
          constants.handle_policy_id,
          constants.pz_handle_asset_name,
        ) == 1
      },
    )
  is {
    None -> None
    Some(input) ->
      when output_data(input.output, tx) is {
        None -> None
        Some(settings_data) -> {
          expect [
            treasury_fee_data,
            treasury_cred_data,
            pz_min_fee_data,
            pz_providers_data,
            valid_contracts_data,
            _admin_creds_data,
            settings_cred_data,
            grace_period_data,
            subhandle_share_percent_data,
          ]: List<Data> = settings_data
          expect settings_cred: ByteArray = settings_cred_data
          let credential_is_valid =
            when input.output.address.payment_credential is {
              address.Script(hash) -> hash == settings_cred
              address.VerificationKey(_) -> False
            }
          if credential_is_valid {
            expect treasury_fee: Int = treasury_fee_data
            expect treasury_cred: ByteArray = treasury_cred_data
            expect pz_min_fee: Int = pz_min_fee_data
            expect pz_providers: Pairs<ByteArray, ByteArray> =
              pz_providers_data
            expect valid_contracts: List<ByteArray> = valid_contracts_data
            expect grace_period: Int = grace_period_data
            expect subhandle_share_percent: Int = subhandle_share_percent_data
            Some(
              (
                treasury_fee,
                treasury_cred,
                pz_min_fee,
                pz_providers,
                valid_contracts,
                settings_cred,
                grace_period,
                subhandle_share_percent,
              ),
            )
          } else {
            None
          }
        }
      }
  }
}

// Persprx-only lean loader: returns just `valid_contracts` (the only PzSettings
// field persprx accesses) after validating the settings ref input's credential.
// Avoids constructing the full 9-field PzSettings record + 8 unused expect casts.
pub fn load_valid_contracts_for_persprx(
  tx: transaction.Transaction,
) -> Option<List<ByteArray>> {
  when
    list.find(
      tx.reference_inputs,
      fn(input) {
        assets.quantity_of(
          input.output.value,
          constants.handle_policy_id,
          constants.pz_handle_asset_name,
        ) == 1
      },
    )
  is {
    None -> None
    Some(input) ->
      when output_data(input.output, tx) is {
        None -> None
        Some(settings_data) -> {
          expect [
            _,
            _,
            _,
            _,
            valid_contracts_data,
            _,
            settings_cred_data,
            _,
            _,
          ]: List<Data> = settings_data
          expect settings_cred: ByteArray = settings_cred_data
          let credential_is_valid =
            when input.output.address.payment_credential is {
              address.Script(hash) -> hash == settings_cred
              address.VerificationKey(_) -> False
            }
          if credential_is_valid {
            expect valid_contracts: List<ByteArray> = valid_contracts_data
            Some(valid_contracts)
          } else {
            None
          }
        }
      }
  }
}

pub fn load_pz_settings(tx: transaction.Transaction) -> Option<types.PzSettings> {
  when
    list.find(
      tx.reference_inputs,
      fn(input) {
        assets.quantity_of(
          input.output.value,
          constants.handle_policy_id,
          constants.pz_handle_asset_name,
        ) == 1
      },
    )
  is {
    Some(input) ->
      when output_data(input.output, tx) is {
        Some(settings_data) -> {
          let settings = parse_pz_settings_from_list(settings_data)
          let credential_is_valid =
            when input.output.address.payment_credential is {
              address.Script(hash) -> hash == settings.settings_cred
              address.VerificationKey(_) -> False
            }

          if credential_is_valid {
            Some(settings)
          } else {
            None
          }
        }
        None -> None
      }
    None -> None
  }
}

fn withdrawal_is_zero_for_credential(
  withdrawals: Pairs<address.Credential, Int>,
  credential: address.Credential,
) -> Bool {
  list.any(withdrawals, fn(withdrawal) { withdrawal.1st == credential && withdrawal.2nd == 0 })
}

fn credential_is_allowed_observer(
  credential: address.Credential,
  valid_contracts: List<ByteArray>,
) -> Bool {
  when credential is {
    address.Script(hash) -> list.any(valid_contracts, fn(contract_hash) { contract_hash == hash })
    address.VerificationKey(_) -> False
  }
}

fn spend_redeemer_data_matches(
  redeemers: Pairs<transaction.ScriptPurpose, transaction.Redeemer>,
  own_ref: transaction.OutputReference,
  expected_data: Data,
) -> Bool {
  list.any(
    redeemers,
    fn(entry) {
      when entry.1st is {
        transaction.Spend(spend_ref) ->
          spend_ref == own_ref && entry.2nd == expected_data
        _ -> False
      }
    },
  )
}

fn observe_redeemer_fields(observer_redeemer_data: Data) -> Option<Pair<transaction.OutputReference, Data>> {
  let Pair(tag, fields) = builtin.un_constr_data(observer_redeemer_data)
  if tag != 0 {
    None
  } else {
    when fields is {
      [own_ref_data, redeemer_data] -> {
        expect own_ref: transaction.OutputReference = own_ref_data
        Some(Pair(own_ref, redeemer_data))
      }
      _ -> None
    }
  }
}

// The pers_proxy spend handler keeps its redeemer as raw `Data` to avoid
// Aiken's auto-cast on the Helios-shaped Personalize Constr (where inner
// fields like Handle / PzIndexes are List-encoded, not Constr-encoded). We
// construct the observer-redeemer Constr manually so byte-for-byte
// equality with the chain's withdrawal redeemer still holds.
//
// Hash-stability rule: persprx is the ONLY caller of this function, and
// persprx is the spend proxy whose script address must be stable across
// validator iterations (existing handles' LBL_100 ref tokens are locked
// at it forever). Any change to this function's body changes persprx's
// inlined UPLC and therefore its on-chain hash, forcing a chain-wide
// migration of every locked LBL_100 — which defeats the proxy's purpose.
// Mem/cpu micro-optimizations (e.g. cheap-first reordering) belong in the
// observer-side `persdsg_observed_for_personalize` etc. instead, where the
// caller (perspz/persdsg) is itself replaceable via pz_settings.valid_contracts.
pub fn observer_withdrawal_is_valid_data(
  tx: transaction.Transaction,
  own_ref: transaction.OutputReference,
  redeemer_data: Data,
  valid_contracts: List<ByteArray>,
) -> Bool {
  let own_ref_data: Data = own_ref
  let observer_redeemer_data: Data =
    builtin.constr_data(0, [own_ref_data, redeemer_data])

  list.any(
    tx.redeemers,
    fn(entry) {
      entry.2nd == observer_redeemer_data && when entry.1st is {
        transaction.Withdraw(credential) ->
          credential_is_allowed_observer(credential, valid_contracts) && withdrawal_is_zero_for_credential(
            tx.withdrawals,
            credential,
          )
        _ -> False
      }
    },
  )
}

// Verify `persdsg` (designer-settings observer) fired for this tx with a
// matching observer-redeemer (Observe { own_ref, redeemer }). perspz uses
// this on the non-reset path to delegate designer_settings validation. The
// observer-redeemer match ensures persdsg validated against the same
// own_ref + spend redeemer perspz is processing.
fn persdsg_observed_for_personalize(
  tx: transaction.Transaction,
  own_ref: transaction.OutputReference,
  redeemer: types.Redeemer,
) -> Bool {
  let own_ref_data: Data = own_ref
  let redeemer_data: Data = redeemer
  let observer_redeemer_data: Data =
    builtin.constr_data(0, [own_ref_data, redeemer_data])
  list.any(
    tx.redeemers,
    fn(entry) {
      when entry.1st is {
        transaction.Withdraw(credential) ->
          when credential is {
            address.Script(hash) -> hash == persdsg_hash
            _ -> False
          } && withdrawal_is_zero_for_credential(tx.withdrawals, credential) && entry.2nd == observer_redeemer_data
        _ -> False
      }
    },
  )
}

// Single CIP-68 reference-input loader. Returns the typed
// `PersonalizationDatum` so callers can destructure for the field they need.
// Centralising the `expect ... = ...` cast here lets Aiken share most of
// the type-check routine across image_matches_datum_check,
// designer_settings_valid_for_personalize, check_required_assets, and
// attribute_match_for_token.
fn cip68_ref_at(
  ref_index: Int,
  tx: transaction.Transaction,
) -> Option<types.PersonalizationDatum> {
  when reference_output_at(tx.reference_inputs, ref_index) is {
    None -> None
    Some(out) ->
      if !output_has_cip68_reference_token(out) {
        None
      } else {
        when output_data(out, tx) is {
          None -> None
          Some(d) -> {
            expect cip68: types.PersonalizationDatum = d
            Some(cip68)
          }
        }
      }
  }
}

fn output_has_cip68_reference_token(output: transaction.Output) -> Bool {
  assets.flatten(output.value)
    |> list.any(fn(t) { bytearray.starts_with(t.2nd, constants.lbl_100) })
}

fn asset_requires_cip68_ref(asset: datum.AssetClass) -> Bool {
  asset != datum.empty_asset && (bytearray.starts_with(
    asset.asset_name,
    constants.lbl_222,
  ) || bytearray.starts_with(asset.asset_name, constants.lbl_444))
}

fn cip68_ref_for_asset(
  asset: datum.AssetClass,
  ref_index: Int,
  tx: transaction.Transaction,
) -> Option<types.PersonalizationDatum> {
  if asset_requires_cip68_ref(asset) {
    cip68_ref_at(ref_index, tx)
  } else {
    None
  }
}

// Returns True if the asset's bg/pfp image referenced in new_extra matches
// the image field of the asset's on-chain CIP-68 reference datum. Vacuously
// True when the asset is empty.
fn image_matches_datum_check(
  asset: datum.AssetClass,
  cip68_opt: Option<types.PersonalizationDatum>,
  image_key: ByteArray,
  new_extra: types.DataMap,
) -> Bool {
  if !asset_requires_cip68_ref(asset) {
    // Helios get_asset_datum returned OutputDatum::new_none() for non-CIP68
    // asset names, and the pfp/bg image check accepted that case.
    True
  } else {
    when cip68_opt is {
      None -> False
      Some(asset_datum) -> {
        let types.Cip68 { nft: asset_nft, .. } = asset_datum
        let asset_image = datum.map_get(asset_nft, key_image)
        asset_image == datum.map_get(new_extra, image_key) && asset_image != None
      }
    }
  }
}

test image_matches_datum_accepts_non_cip68_asset_without_reference_datum() {
  let asset =
    datum.AssetClass {
      policy_id: #"eb66d2159d51cec7bd469c0daef8a93e0d2066f55d3c1a9cf5bc0393",
      asset_name: "Test 3 DiscoSolaris4601",
    }

  image_matches_datum_check(asset, None, key_pfp_image, [])
}

test cip68_ref_for_asset_ignores_non_cip68_asset_with_root_at_zero() {
  let asset =
    datum.AssetClass {
      policy_id: #"eb66d2159d51cec7bd469c0daef8a93e0d2066f55d3c1a9cf5bc0393",
      asset_name: "Test 3 DiscoSolaris4601",
    }
  let root_data: Data =
    #"c150d28d1c69ce53a137fd62bb8e4b0d065b545f33f638b2a2b09989332efb84"
  let tx =
    transaction.Transaction {
      ..transaction.placeholder,
      reference_inputs: [
        transaction.Input {
          output_reference: transaction.OutputReference {
            transaction_id: #"0101010101010101010101010101010101010101010101010101010101010101",
            output_index: 0,
          },
          output: transaction.Output {
            address: address.from_script(#"bb"),
            value: assets.from_asset(
              constants.handle_policy_id,
              constants.prefixed_asset_name(constants.lbl_222, key_policy_ids_pfp),
              1,
            ),
            datum: transaction.InlineDatum(root_data),
            reference_script: None,
          },
        },
      ],
    }

  cip68_ref_for_asset(asset, 0, tx) == None
}

test pz_indexes_external_data_field_order_matches_bff_redeemer() {
  let raw_indexes: Data =
    builtin.constr_data(0, [
      builtin.i_data(11),
      builtin.i_data(22),
      builtin.i_data(33),
      builtin.i_data(44),
      builtin.i_data(55),
      builtin.i_data(66),
      builtin.i_data(77),
      builtin.i_data(88),
      builtin.i_data(99),
    ])
  expect indexes: types.PzIndexes = raw_indexes
  and {
    indexes.pfp_approver == 11,
    indexes.bg_approver == 22,
    indexes.pfp_datum == 33,
    indexes.bg_datum == 44,
    indexes.required_asset == 55,
    indexes.owner_settings == 66,
    indexes.contract_output == 77,
    indexes.pz_assets == 88,
    indexes.provider_fee == 99,
  }
}

test image_matches_datum_rejects_cip68_asset_without_reference_datum() {
  let asset =
    datum.AssetClass {
      policy_id: #"8ed30c080aba8eb431dabb802ea8dda3a131b0f49c72d2766b25b1eb",
      asset_name: bytearray.concat(constants.lbl_444, "handles_bg_boat_2"),
    }

  !image_matches_datum_check(asset, None, key_bg_image, [])
}

fn current_validator_hash(
  own_ref: transaction.OutputReference,
  tx: transaction.Transaction,
) -> Option<ByteArray> {
  when transaction.find_input(tx.inputs, own_ref) is {
    Some(input) ->
      when input.output.address.payment_credential is {
        address.Script(hash) -> Some(hash)
        address.VerificationKey(_) -> None
      }
    None -> None
  }
}

fn output_at(
  outputs: List<transaction.Output>,
  index: Int,
) -> Option<transaction.Output> {
  list.at(outputs, index)
}

fn reference_output_at(
  reference_inputs: List<transaction.Input>,
  index: Int,
) -> Option<transaction.Output> {
  when list.at(reference_inputs, index) is {
    Some(input) -> Some(input.output)
    None -> None
  }
}

fn output_has_handle_asset(
  output: transaction.Output,
  asset_name: ByteArray,
) -> Bool {
  assets.quantity_of(output.value, constants.handle_policy_id, asset_name) == 1
}

// Wire-up: load bg_datum.extra (the creator's defaults) and the on-chain
// designer-hash from new_extra, then delegate to designer_settings.
// Mirrors how Helios calls `designer_settings_are_valid(designer, defaults,
// new_extra.get_safe("designer"))` from inside the personalize branch.
//
// When new_extra has no "designer" key, Helios's call to .unwrap() crashes —
// here we fail validation explicitly. When the bg ref-input or its datum is
// missing, defaults default to empty (no constraints), preserving Helios's
// `if (bg_datum == EMPTY_CIP_68) Map[String]Data{}` fallback.
fn designer_settings_valid_for_personalize(
  designer: types.DataMap,
  bg_cip68_opt: Option<types.PersonalizationDatum>,
  new_extra: types.DataMap,
) -> Bool {
  let defaults =
    when bg_cip68_opt is {
      None -> []
      Some(bg_datum) -> datum.get_extra(bg_datum.extra)
    }
  designer_settings.designer_settings_are_valid(
    designer,
    defaults,
    datum.map_get(new_extra, "designer"),
  )
}

// Helios `check_required_assets` port. Validates the bg's creator-default
// requirement set (declared inline on bg's CIP-68 reference datum's `extra`
// map) against this personalize tx. See pers.helios:275-326 for the exact
// semantics being preserved:
//
//   - `required_signature` (ByteArray pubkey-hash) → tx.extra_signatories
//   - `require_asset_collections` (List<ByteArray>) → at least one entry's
//     `policy_id ++ name_prefix` matches a token in pz_asset_output.value
//   - `require_asset_attributes` (List<String>) — for the matched
//     LBL_222/444 token, the CIP-68 reference datum at
//     `indexes.required_asset` must carry every "key:value" attribute.
//     CIP-25 collections trivially pass (no on-chain attributes to inspect).
//   - `require_asset_displayed` (Int 0|1) — if 1, the matched asset must be
//     the pfp asset OR the handle being personalized.
fn check_required_assets(
  pz_asset_output: transaction.Output,
  bg_cip68_opt: Option<types.PersonalizationDatum>,
  required_asset_index: Int,
  handle_name: ByteArray,
  pfp_asset: datum.AssetClass,
  tx: transaction.Transaction,
) -> Bool {
  when bg_cip68_opt is {
    None -> False
    Some(bg_datum) -> {
      let defaults = datum.get_extra(bg_datum.extra)
      when defaults is {
        [] -> True
        _ ->
          required_assets_inner(
            defaults,
            pz_asset_output,
            required_asset_index,
            handle_name,
            pfp_asset,
            tx,
          )
      }
    }
  }
}

fn required_assets_inner(
  defaults: types.DataMap,
  pz_asset_output: transaction.Output,
  required_asset_index: Int,
  handle_name: ByteArray,
  pfp_asset: datum.AssetClass,
  tx: transaction.Transaction,
) -> Bool {
  let sig_ok =
    when datum.map_get(defaults, "required_signature") is {
      None -> True
      Some(sig_data) -> {
        expect sig_hash: ByteArray = sig_data
        list.has(tx.extra_signatories, sig_hash)
      }
    }
  sig_ok && when datum.map_get(defaults, "require_asset_collections") is {
    None -> True
    Some(coll_data) -> {
      expect coll_list: List<ByteArray> = coll_data
      let attr_opt = datum.map_get(defaults, "require_asset_attributes")
      let must_display =
        datum.int_or(datum.map_get(defaults, "require_asset_displayed"), 0) != 0
      let flattened = assets.flatten(pz_asset_output.value)
      list.any(
        coll_list,
        fn(coll_bytes) {
          let policy_id = bytearray.take(coll_bytes, 28)
          let name_prefix = bytearray.drop(coll_bytes, 28)
          when
            list.find(
              flattened,
              fn(t) {
                t.1st == policy_id && bytearray.starts_with(t.2nd, name_prefix)
              },
            )
          is {
            None -> False
            Some(t) ->
              attribute_match_for_token(
                t.1st,
                t.2nd,
                attr_opt,
                required_asset_index,
                tx,
              ) && (
                !must_display || display_match(
                  t.1st,
                  t.2nd,
                  coll_bytes,
                  pfp_asset,
                  handle_name,
                )
              )
          }
        },
      )
    }
  }
}

fn attribute_match_for_token(
  policy_id: ByteArray,
  asset_name: ByteArray,
  attr_opt: Option<Data>,
  required_asset_index: Int,
  tx: transaction.Transaction,
) -> Bool {
  when attr_opt is {
    None -> True
    Some(attr_data) ->
      // CIP-25 collections (no CIP-68 ref-token) — Helios trivially passes.
      if !bytearray.starts_with(asset_name, constants.lbl_222) && !bytearray.starts_with(
        asset_name,
        constants.lbl_444,
      ) {
        True
      } else {
        expect attr_list: List<ByteArray> = attr_data
        let ref_token_name =
          bytearray.concat(constants.lbl_100, bytearray.drop(asset_name, 4))
        when reference_output_at(tx.reference_inputs, required_asset_index) is {
          None -> False
          Some(out) ->
            assets.quantity_of(out.value, policy_id, ref_token_name) == 1 && when
              cip68_ref_at(required_asset_index, tx)
            is {
              None -> False
              Some(cip68) -> {
                let attributes =
                  when datum.map_get(cip68.nft, "attributes") is {
                    Some(att_data) -> {
                      expect att_map: types.DataMap = att_data
                      att_map
                    }
                    None -> cip68.nft
                  }
                list.all(
                  attr_list,
                  fn(attr_bytes) {
                    when bytearray.index_of(attr_bytes, #"3a") is {
                      None -> False
                      Some((start, _)) -> {
                        let key = bytearray.take(attr_bytes, start)
                        let value = bytearray.drop(attr_bytes, start + 1)
                        when datum.map_get(attributes, key) is {
                          None -> False
                          Some(v_data) ->
                            builtin.choose_data(
                              v_data,
                              False,
                              False,
                              False,
                              False,
                              {
                                expect v_bytes: ByteArray = v_data
                                v_bytes == value
                              },
                            )
                        }
                      }
                    }
                  },
                )
              }
            }
        }
      }
  }
}

// "must_display" rule: the matched asset must be the pfp asset (whose own
// policy_id ++ asset_name itself starts with the required `coll_bytes`
// prefix) OR the handle being personalized (handle policy + LBL_222 + name).
fn display_match(
  policy_id: ByteArray,
  asset_name: ByteArray,
  coll_bytes: ByteArray,
  pfp_asset: datum.AssetClass,
  handle_name: ByteArray,
) -> Bool {
  pfp_asset != datum.empty_asset && bytearray.starts_with(
    bytearray.concat(pfp_asset.policy_id, pfp_asset.asset_name),
    coll_bytes,
  ) && pfp_asset.policy_id == policy_id && pfp_asset.asset_name == asset_name || bytearray.starts_with(
    bytearray.concat(
      constants.handle_hash,
      bytearray.concat(constants.lbl_222, handle_name),
    ),
    coll_bytes,
  )
}

fn outputs_have_owner_token(
  outputs: List<transaction.Output>,
  handle: ByteArray,
) -> Bool {
  let owner_token_name = constants.prefixed_asset_name(constants.lbl_222, handle)
  list.any(outputs, fn(output) { output_has_handle_asset(output, owner_token_name) })
}

fn validity_start(tx: transaction.Transaction) -> Option<Int> {
  when tx.validity_range.lower_bound.bound_type is {
    interval.Finite(start) -> Some(start)
    _ -> None
  }
}

fn parse_resolved_address(extra: types.DataMap) -> Option<address.Address> {
  when datum.map_get(extra, key_resolved_addresses) is {
    Some(resolved_data) ->
      when datum.map_get(datum.get_extra(resolved_data), key_ada) is {
        Some(addr_data) -> {
          expect addr_bytes: ByteArray = addr_data
          utils.address_from_shelley_bytes(addr_bytes)
        }
        None -> None
      }
    None -> None
  }
}

fn parse_virtual_data(extra: types.DataMap) -> Option<types.DataMap> {
  when datum.map_get(extra, key_virtual) is {
    Some(virtual_data) -> Some(datum.get_extra(virtual_data))
    None -> None
  }
}

fn pz_payload_without_virtual_and_resolved(
  extra: types.DataMap,
) -> types.DataMap {
  list.filter(
    extra,
    fn(entry) {
      entry.1st != key_virtual && entry.1st != key_resolved_addresses
    },
  )
}

fn signer_matches_payment_credential(
  signatories: List<ByteArray>,
  payment_credential: address.PaymentCredential,
) -> Bool {
  when payment_credential is {
    address.VerificationKey(signer) ->
      list.has(signatories, signer)
    address.Script(_) -> False
  }
}

fn signer_matches_stake_credential(
  signatories: List<ByteArray>,
  stake_credential: Option<address.StakeCredential>,
) -> Bool {
  when stake_credential is {
    Some(address.Inline(address.VerificationKey(signer))) ->
      list.has(signatories, signer)
    _ -> False
  }
}

fn value_paid_to_with_handle_datum(
  tx: transaction.Transaction,
  target_address: address.Address,
  handle: ByteArray,
  min_lovelace: Int,
) -> Bool {
  let handle_data: Data = handle

  list.any(
    tx.outputs,
    fn(output) {
      output.address == target_address && assets.lovelace_of(output.value) >= min_lovelace && when
        output_data(output, tx)
      is {
        Some(datum_data) -> datum_data == handle_data
        None -> False
      }
    },
  )
}

type PersonalizeTxContext {
  PersonalizeTxContext {
    old_datum: types.PersonalizationDatum,
    new_datum: types.PersonalizationDatum,
    old_extra: types.DataMap,
    new_extra: types.DataMap,
    contract_output: transaction.Output,
    pz_asset_output: transaction.Output,
  }
}

fn personalize_context_from_tx(
  old_datum_data: Data,
  indexes: types.PzIndexes,
  reset: Bool,
  tx: transaction.Transaction,
) -> Option<PersonalizeTxContext> {
  expect old_datum: types.PersonalizationDatum = old_datum_data
  let types.Cip68 { nft: _, version: _, extra: old_extra_data } = old_datum
  let old_extra = datum.get_extra(old_extra_data)

  when output_at(tx.outputs, indexes.contract_output) is {
    Some(contract_output) ->
      when output_data(contract_output, tx) is {
        Some(new_datum_data) -> {
          expect new_datum: types.PersonalizationDatum = new_datum_data
          let types.Cip68 { nft: _, version: _, extra: new_extra_data } =
            new_datum
          let new_extra = datum.get_extra(new_extra_data)

          when
            if reset {
              reference_output_at(tx.reference_inputs, indexes.pz_assets)
            } else {
              output_at(tx.outputs, indexes.pz_assets)
            }
          is {
            Some(pz_asset_output) ->
              Some(
                PersonalizeTxContext {
                  old_datum,
                  new_datum,
                  old_extra,
                  new_extra,
                  contract_output,
                  pz_asset_output,
                },
              )
            None -> None
          }
        }
        None -> None
      }
    None -> None
  }
}

// Loads the tx context (contract output, pz_asset output, old/new datums)
// and dispatches the entire validation. Inlining the context-loading here
// avoids constructing PersonalizeTxContext + the Option<PersonalizeTxContext>
// wrapper that personalize_context_from_tx returns to test callers.
fn personalize_validate(
  handle: types.Handle,
  indexes: types.PzIndexes,
  designer: types.DataMap,
  treasury_fee: Int,
  treasury_cred: ByteArray,
  pz_min_fee: Int,
  pz_providers: Pairs<ByteArray, ByteArray>,
  valid_contracts: List<ByteArray>,
  settings_cred: ByteArray,
  grace_period: Int,
  subhandle_share_percent: Int,
  own_ref: transaction.OutputReference,
  reset: Bool,
  old_datum_data: Data,
  tx: transaction.Transaction,
) -> Bool {
  expect old_datum: types.PersonalizationDatum = old_datum_data
  let types.Cip68 { nft: _, version: _, extra: old_extra_data } = old_datum
  let old_extra = datum.get_extra(old_extra_data)
  when output_at(tx.outputs, indexes.contract_output) is {
    None -> False
    Some(contract_output) ->
      when output_data(contract_output, tx) is {
        None -> False
        Some(new_datum_data) -> {
          expect new_datum: types.PersonalizationDatum = new_datum_data
          let types.Cip68 { nft: _, version: _, extra: new_extra_data } =
            new_datum
          let new_extra = datum.get_extra(new_extra_data)
          when
            if reset {
              reference_output_at(tx.reference_inputs, indexes.pz_assets)
            } else {
              output_at(tx.outputs, indexes.pz_assets)
            }
          is {
            None -> False
            Some(pz_asset_output) -> {
  let old_bg_asset =
    personalize_mpf_context.asset_from_extra(old_extra, key_bg_asset)
  let old_pfp_asset =
    personalize_mpf_context.asset_from_extra(old_extra, key_pfp_asset)
  let new_bg_asset =
    personalize_mpf_context.asset_from_extra(new_extra, key_bg_asset)
  let new_pfp_asset =
    personalize_mpf_context.asset_from_extra(new_extra, key_pfp_asset)
  let check_pfp_asset =
    if reset {
      old_pfp_asset
    } else {
      new_pfp_asset
    }
  let bg_proof =
    personalize_mpf_context.proof_from_designer(designer, key_bg_proof)
  let pfp_proof =
    personalize_mpf_context.proof_from_designer(designer, key_pfp_proof)
  let bg_root =
    personalize_mpf_context.load_policy_index_root(
      indexes.bg_approver,
      key_policy_ids_bg,
      pz_providers,
      settings_cred,
      tx,
    )
  let pfp_root =
    personalize_mpf_context.load_policy_index_root(
      indexes.pfp_approver,
      key_policy_ids_pfp,
      pz_providers,
      settings_cred,
      tx,
    )
  let pz_asset_value = pz_asset_output.value
  let approve_bg =
    fn(asset) {
      personalize_mpf_context.approval_status_for_asset(
        bg_root,
        asset,
        pz_asset_value,
        bg_proof,
      )
    }
  let approve_pfp =
    fn(asset) {
      personalize_mpf_context.approval_status_for_asset(
        pfp_root,
        asset,
        pz_asset_value,
        pfp_proof,
      )
    }
  let bg_status = approve_bg(new_bg_asset)
  let pfp_status = approve_pfp(new_pfp_asset)
  let check_bg_status =
    if reset {
      approve_bg(old_bg_asset)
    } else {
      bg_status
    }
  let check_pfp_status =
    if reset {
      approve_pfp(old_pfp_asset)
    } else {
      pfp_status
    }
  let types.Cip68 { nft: old_nft, version: _, extra: _ } = old_datum
  let datum_name_matches_redeemer =
    when datum.map_get(old_nft, key_name) is {
      Some(name_data) -> {
        expect datum_name: ByteArray = name_data
        bytearray.drop(datum_name, 1) == handle.name
      }
      None -> False
    }
  let contract_output_is_valid =
    when current_validator_hash(own_ref, tx) is {
      Some(current_hash) ->
        utils.is_valid_contract(
          contract_output,
          valid_contracts,
          current_hash,
        )
      None -> False
    }

  // owner_handle_present: pz_asset_output must hold the LBL_222 owner token.
  // Helios: `pz_asset_output.value.contains(Value::new(LBL_222 + name, 1))`
  let owner_handle_present =
    assets.quantity_of(
      pz_asset_output.value,
      constants.handle_policy_id,
      constants.prefixed_asset_name(constants.lbl_222, handle.name),
    ) == 1

  // resolved_ada_is_empty: new_extra.resolved_addresses must NOT contain
  // an "ada" key (asserted for non-virtual).
  // Helios: `resolved_ada_opt = new_resolved.get_safe("ada"); resolved_ada = resolved_ada_opt == None`
  let resolved_ada_is_empty =
    when datum.map_get(new_extra, key_resolved_addresses) is {
      Some(resolved_data) -> {
        let resolved_map = datum.get_extra(resolved_data)
        datum.map_get(resolved_map, key_ada) == None
      }
      None -> True
    }

  // last_update_address: new_extra.last_update_address parsed as Shelley
  // address. For HANDLE/NFT_SUBHANDLE compare to pz_asset_output.address;
  // for VIRTUAL_SUBHANDLE compare to the new resolved-ada address.
  let new_last_update_address_data =
    datum.map_get(new_extra, key_last_update_address)
  let parsed_last_update_address =
    when new_last_update_address_data is {
      Some(addr_data) -> {
        expect addr_bytes: ByteArray = addr_data
        utils.address_from_shelley_bytes(addr_bytes)
      }
      None -> None
    }
  // Helios:
  //   HANDLE / NFT_SUBHANDLE -> address = pz_asset_output.address
  //   VIRTUAL_SUBHANDLE      -> address = new_ada_address (Option, may be None)
  let last_update_address_matches_owner =
    when parsed_last_update_address is {
      None -> False
      Some(last_addr) ->
        if handle.handle_type == types.HandleTypeVirtualSubhandle {
          when parse_resolved_address(new_extra) is {
            None -> False
            Some(expected) -> last_addr == expected
          }
        } else {
          last_addr == pz_asset_output.address
        }
    }

  // immutables_unchanged: per Helios immutables_are_unchanged.
  //   - extra.standard_image, extra.standard_image_hash, extra.original_address
  //     must equal between old and new
  //   - every old_nft.* (except 'image' and 'mediaType') must equal new_nft.*
  //   - new_extra.agreed_terms must equal "https://handle.me/$/tou"
  let types.Cip68 { nft: new_nft, version: _, extra: _ } = new_datum
  let standard_unchanged =
    list.all(
      standard_unchanged_keys,
      fn(k) { datum.map_get(old_extra, k) == datum.map_get(new_extra, k) },
    )
  let immutable_nft_fields_unchanged =
    list.all(
      old_nft,
      fn(pair) {
        let key = pair.1st
        if key == key_image || key == "mediaType" {
          True
        } else {
          datum.map_get(new_nft, key) == Some(pair.2nd)
        }
      },
    )
  let agreed_terms_is_set =
    when datum.map_get(new_extra, key_agreed_terms) is {
      Some(terms_data) -> {
        expect terms: ByteArray = terms_data
        terms == "https://handle.me/$/tou"
      }
      None -> False
    }
  let immutables_unchanged = and {
      standard_unchanged,
      immutable_nft_fields_unchanged,
      agreed_terms_is_set,
    }

  // sub_pz_enabled / new_pz_enabled — read from old/new extra.
  let sub_pz_enabled =
    datum.int_or(datum.map_get(old_extra, key_pz_enabled), 0) != 0
  let new_pz_enabled =
    datum.int_or(datum.map_get(new_extra, key_pz_enabled), 0) != 0

  // root_pz_enabled + payment_address from owner_settings ref input.
  // For HANDLE type, Helios returns (True, ""). For NFT/VIRTUAL subhandle,
  // looks up OwnerSettings.{nft|virtual}.pz_enabled from indexes.owner_settings.
  // Only 3 fields of OwnerSettings are needed here (nft.pz_enabled,
  // virtual.pz_enabled, payment_address). Extract them positionally without
  // building the full OwnerSettings + 2 SubHandleSettings records.
  let (root_pz_enabled, root_payment_address) =
    when handle.handle_type is {
      types.HandleTypeHandle -> (True, #"")
      other ->
        when reference_output_at(tx.reference_inputs, indexes.owner_settings) is {
          Some(owner_output) ->
            when output_data(owner_output, tx) is {
              Some(owner_data) -> {
                expect [
                  nft_data,
                  virtual_data,
                  _,
                  _,
                  _,
                  _,
                  _,
                  payment_address_data,
                ]: List<Data> = owner_data
                let sh_data =
                  if other == types.HandleTypeNftSubhandle {
                    nft_data
                  } else {
                    virtual_data
                  }
                expect [_, pz_enabled_data, _, _, _]: List<Data> = sh_data
                expect pz_enabled: Int = pz_enabled_data
                expect payment_address: ByteArray = payment_address_data
                (pz_enabled == 1, payment_address)
              }
              None -> (False, #"")
            }
          None -> (False, #"")
        }
    }

  // validated_by_* / expected_nsfw / bg/pfp image fields for policy_datum_is_valid.
  let validated_by_data_opt = datum.map_get(new_extra, "validated_by")
  let validated_by_present = validated_by_data_opt != None
  let validated_by_signed =
    when validated_by_data_opt is {
      Some(vb_data) -> {
        expect vb_hash: ByteArray = vb_data
        list.has(tx.extra_signatories, vb_hash)
      }
      None -> False
    }
  let expected_nsfw = datum.int_or(datum.map_get(new_extra, key_nsfw), 0)
  let bg_image_set = datum.map_get(new_extra, key_bg_image) != None
  let pfp_image_set = datum.map_get(new_extra, key_pfp_image) != None

  // Pre-load the bg and pfp CIP-68 reference datums once. Used by both the
  // image-matches check and (for bg) by designer_settings + check_required_assets.
  // Avoids 3 separate list.at walks of tx.reference_inputs at indexes.bg_datum.
  let bg_cip68_opt = cip68_ref_for_asset(new_bg_asset, indexes.bg_datum, tx)
  let pfp_cip68_opt = cip68_ref_for_asset(new_pfp_asset, indexes.pfp_datum, tx)
  // bg/pfp_image_matches_datum: when asset is set, the asset's CIP-68 reference
  // datum must have nft.image == new_extra.{bg,pfp}_image. Empty asset → True.
  let bg_image_matches_datum =
    image_matches_datum_check(new_bg_asset, bg_cip68_opt, key_bg_image, new_extra)
  let pfp_image_matches_datum =
    image_matches_datum_check(new_pfp_asset, pfp_cip68_opt, key_pfp_image, new_extra)

  // is_reset_shape: new datum looks like a reset state (no images, no assets,
  // no designer, trial/nsfw cleared). Helios:
  //   new_image == new_standard
  //   && new_img_hash == new_stand_hash
  //   && new_pfp_asset_opt == EMPTY_DATA
  //   && new_bg_asset_opt == EMPTY_DATA
  //   && new_pfp == None && new_bg == None
  //   && !designed
  //   && new_trial == 0 && new_nsfw == 0
  let new_designer_data = datum.map_get(new_extra, key_designer)
  let designed = new_designer_data != None
  let is_reset_shape = and {
      datum.map_get(new_nft, key_image) == datum.map_get(new_extra, key_standard_image),
      datum.map_get(new_extra, key_image_hash) == datum.map_get(new_extra, key_standard_image_hash),
      new_bg_asset == datum.empty_asset,
      new_pfp_asset == datum.empty_asset,
      !bg_image_set,
      !pfp_image_set,
      !designed,
      datum.int_or(datum.map_get(new_extra, key_trial), 0) == 0,
      expected_nsfw == 0,
    }

  // signed_by_owner / signed_by_provider — used by reset auth + reset privacy.
  // signed_by_owner: tx signed by the owner of the LBL_222 owner token's
  // payment address. We don't have the address directly here; we use the
  // pz_asset_output.address payment cred (Helios uses `address.credential`).
  let signed_by_owner =
    when pz_asset_output.address.payment_credential is {
      address.VerificationKey(hash) ->
        list.has(tx.extra_signatories, hash)
      _ -> False
    }
  let signed_by_provider =
    list.any(
      pz_providers,
      fn(provider) { list.has(tx.extra_signatories, provider.2nd) },
    )

  // reset_privacy_inputs — for the reset path. Helios checks (line 686-696):
  //   if last_update_address changed (holder changed), socials and
  //   resolved_addresses must be cleared. Otherwise either provider or
  //   owner must sign, OR both socials and resolved_addresses unchanged.
  let old_last_update_address_data = datum.map_get(old_extra, key_last_update_address)
  let holder_changed =
    when old_last_update_address_data is {
      None -> True
      Some(old_addr_data) ->
        when new_last_update_address_data is {
          None -> True
          Some(new_addr_data) -> {
            expect old_bytes: ByteArray = old_addr_data
            expect new_bytes: ByteArray = new_addr_data
            when utils.address_from_shelley_bytes(old_bytes) is {
              None -> True
              Some(old_a) ->
                when utils.address_from_shelley_bytes(new_bytes) is {
                  None -> True
                  Some(new_a) -> !utils.holder_addresses_match(old_a, new_a)
                }
            }
          }
        }
    }
  let new_socials_data = datum.map_get(new_extra, key_socials)
  let socials_cleared = new_socials_data == None
  let new_resolved_addresses_data = datum.map_get(new_extra, key_resolved_addresses)
  let resolved_addresses_cleared = new_resolved_addresses_data == None
  let socials_unchanged =
    datum.map_get(old_extra, key_socials) == new_socials_data
  let resolved_addresses_unchanged =
    datum.map_get(old_extra, key_resolved_addresses) == new_resolved_addresses_data
  // Inlined personalize_base.reset_privacy_is_valid: avoids constructing
  // the 7-field ResetPrivacyInputs record in the validator path.
  let reset_privacy_pass =
    if holder_changed {
      socials_cleared && resolved_addresses_cleared
    } else {
      signed_by_provider || signed_by_owner || socials_unchanged && resolved_addresses_unchanged
    }

  // unchanged_when_reset_denied — Helios line 704-713: when designer assets
  // and required_assets are valid (i.e. no provider/owner sig and not reset),
  // the new datum must be the SAME as the old (no changes allowed at all):
  //   image, image_hash, pfp_asset, bg_asset, pfp_image, bg_image, designer,
  //   trial, nsfw all unchanged between old_extra and new_extra (image is on
  //   nft, others on extra).
  // Virtual subhandle invariants (Helios line 612-618). Only material when
  // handle_type == VIRTUAL_SUBHANDLE; for other types the validator gate
  // short-circuits via virtual_personalization_rules_are_valid.
  let old_resolved_ada = parse_resolved_address(old_extra)
  let new_resolved_ada = parse_resolved_address(new_extra)
  let virtual_holder_signed =
    when old_resolved_ada is {
      Some(old_addr) ->
        when old_addr.payment_credential is {
          address.VerificationKey(hash) ->
            list.has(tx.extra_signatories, hash)
          _ -> False
        }
      None -> False
    }
  let virtual_resolved_ada_unchanged =
    when old_resolved_ada is {
      None ->
        when new_resolved_ada is {
          None -> True
          Some(_) -> False
        }
      Some(old_addr) ->
        when new_resolved_ada is {
          None -> False
          Some(new_addr) -> old_addr == new_addr
        }
    }
  let virtual_payload_unchanged =
    datum.map_get(old_extra, key_virtual) == datum.map_get(new_extra, key_virtual)

  let unchanged_when_reset_denied =
    datum.map_get(old_nft, key_image) == datum.map_get(new_nft, key_image) && list.all(
      immutable_extra_keys,
      fn(k) { datum.map_get(old_extra, k) == datum.map_get(new_extra, k) },
    )

  // fees_paid — translates Helios fees_are_paid. For non-reset designer
  // changes, the personalization tx must pay treasury + provider fees, plus
  // (for subhandles) a root-share to the root handle's payment address.
  // Within the grace_period after last_edited_time, all fees are waived.
  let last_edited_time =
    datum.int_or(datum.map_get(old_extra, key_last_edited_time), 0)
  let within_grace_period =
    last_edited_time != 0 && when validity_start(tx) is {
      Some(start) -> start < last_edited_time + grace_period
      None -> False
    }
  let is_subhandle = handle.handle_type != types.HandleTypeHandle
  let subhandle_shared_fee =
    personalize_base.shared_subhandle_fee(pz_min_fee, subhandle_share_percent)
  let provider_amount =
    if is_subhandle {
      pz_min_fee - subhandle_shared_fee
    } else {
      pz_min_fee
    }

  // Shared check: output's inline datum is the handle name AND output value
  // pays at least min_lovelace. Used by treasury / provider / root fee paths.
  let output_pays_handle = fn(out: transaction.Output, min_lovelace: Int) -> Bool {
    assets.lovelace_of(out.value) >= min_lovelace && when
      datum.from_transaction_datum(out.datum)
    is {
      datum.InlineDatumRef(d) -> {
        expect handle_bytes: ByteArray = d
        handle_bytes == handle.name
      }
      _ -> False
    }
  }

  // treasury_fee_paid: any output to treasury script credential with the
  // handle name as inline datum and at least treasury_fee lovelace.
  let treasury_fee_paid =
    list.any(
      tx.outputs,
      fn(output) {
        when output.address.payment_credential is {
          address.Script(hash) ->
            hash == treasury_cred && output_pays_handle(
              output,
              treasury_fee,
            )
          _ -> False
        }
      },
    )

  // provider_fee_paid: output at indexes.provider_fee whose payment cred is
  // one of the registered providers and inline datum is the handle.
  let provider_fee_paid =
    when output_at(tx.outputs, indexes.provider_fee) is {
      Some(prov_output) -> {
        let cred_hash =
          when prov_output.address.payment_credential is {
            address.VerificationKey(hash) -> hash
            address.Script(hash) -> hash
          }
        list.any(pz_providers, fn(provider) { cred_hash == provider.2nd }) && output_pays_handle(
          prov_output,
          provider_amount,
        )
      }
      None -> False
    }

  // root_fee_paid: only for subhandles. Output sent to root payment_address
  // (resolved bech32 bytes from OwnerSettings) with handle datum and at
  // least subhandle_shared_fee lovelace.
  let root_fee_paid =
    !is_subhandle || when utils.address_from_shelley_bytes(root_payment_address) is {
      Some(root_addr) ->
        list.any(
          tx.outputs,
          fn(output) {
            output.address == root_addr && output_pays_handle(
              output,
              subhandle_shared_fee,
            )
          },
        )
      None -> False
    }
  let fees_paid =
    if within_grace_period {
      True
    } else if !treasury_fee_paid {
      False
    } else if !provider_fee_paid {
      False
    } else {
      !is_subhandle || root_fee_paid
    }

  // Inlined personalize_is_valid + virtual_personalization_rules_are_valid:
  // returning Bool directly avoids constructing the 30-field
  // PersonalizeValidationInputs record in the validator path. The record and
  // personalize_is_valid remain for unit tests; Aiken DCE drops them from
  // the perspz binary because no validator path reaches them.
  let output_has_expected_handle_token =
    assets.quantity_of(
      contract_output.value,
      constants.handle_policy_id,
      bytearray.concat(
        if handle.handle_type == types.HandleTypeVirtualSubhandle {
          constants.lbl_000
        } else {
          constants.lbl_100
        },
        handle.name,
      ),
    ) == 1
  let designer_changed =
    new_designer_data != datum.map_get(old_extra, key_designer)
  let required_asset_valid =
    new_bg_asset == datum.empty_asset || check_required_assets(
      pz_asset_output,
      bg_cip68_opt,
      indexes.required_asset,
      handle.name,
      check_pfp_asset,
      tx,
    )
  // designer_settings_valid is now enforced by the `persdsg` observer (see
  // persdsg.ak). dispatch_personalize_from_tx gates its non-reset call to
  // personalize_validate on `persdsg_observed_for_personalize`, so by the
  // time we're inside personalize_validate's non-reset branch, designer_settings
  // has already been validated. The `designer` parameter is still used by
  // proof_from_designer for the bg/pfp MPF proofs.

  // Inlined personalize_policy_approval.policy_datum_is_valid: avoids
  // constructing the 9-field PolicyDatumValidationInputs record.
  let bg_asset_set = new_bg_asset != datum.empty_asset
  let pfp_asset_set = new_pfp_asset != datum.empty_asset
  let policy_datum_pass = and {
      !validated_by_present || validated_by_signed,
      personalize_policy_approval.approvals_are_valid(bg_status, pfp_status),
      bg_asset_set == bg_image_set,
      pfp_asset_set == pfp_image_set,
      !bg_asset_set || bg_image_matches_datum,
      !pfp_asset_set || pfp_image_matches_datum,
      personalize_policy_approval.derive_nsfw(bg_status, pfp_status) == expected_nsfw,
    }
  let virtual_rules_pass =
    handle.handle_type != types.HandleTypeVirtualSubhandle || and {
        reset || virtual_holder_signed,
        virtual_resolved_ada_unchanged,
        virtual_payload_unchanged,
      }
  let common_gates_pass = and {
      datum_name_matches_redeemer,
      output_has_expected_handle_token,
      last_update_address_matches_owner,
      personalize_base.subhandle_personalization_is_allowed(
        handle.handle_type,
        reset,
        sub_pz_enabled,
        root_pz_enabled,
        new_pz_enabled,
      ),
      handle.handle_type == types.HandleTypeVirtualSubhandle || reset || owner_handle_present,
      personalize_base.resolved_ada_is_allowed(handle.handle_type) || resolved_ada_is_empty,
      virtual_rules_pass,
      contract_output_is_valid,
      immutables_unchanged,
      policy_datum_pass,
    }
  // Inlined non_reset_authorization_is_valid + reset_authorization_is_valid.
  common_gates_pass && if reset {
    let designer_assets_valid =
      personalize_policy_approval.approvals_are_valid(
        check_bg_status,
        check_pfp_status,
      )
    reset_privacy_pass && if !designer_assets_valid || !required_asset_valid || signed_by_provider || signed_by_owner {
      is_reset_shape
    } else {
      unchanged_when_reset_denied
    }
  } else if designed && designer_changed {
    // designer_settings is enforced by persdsg observer (see persdsg_observed_for_personalize
    // in dispatch_personalize_from_tx).
    required_asset_valid && fees_paid
  } else {
    designed || is_reset_shape
  }
            }
          }
        }
      }
  }
}

pub type PersonalizeValidationInputs {
  handle_type: types.HandleType,
  reset: Bool,
  datum_name_matches_redeemer: Bool,
  output_has_expected_handle_token: Bool,
  last_update_address_matches_owner: Bool,
  owner_handle_present: Bool,
  resolved_ada_is_empty: Bool,
  sub_pz_enabled: Bool,
  root_pz_enabled: Bool,
  new_pz_enabled: Bool,
  virtual_holder_signed: Bool,
  virtual_resolved_ada_unchanged: Bool,
  virtual_payload_unchanged: Bool,
  contract_output_is_valid: Bool,
  immutables_unchanged: Bool,
  bg_status: personalize_policy_approval.AssetApprovalStatus,
  pfp_status: personalize_policy_approval.AssetApprovalStatus,
  check_bg_status: personalize_policy_approval.AssetApprovalStatus,
  check_pfp_status: personalize_policy_approval.AssetApprovalStatus,
  policy_datum_inputs: personalize_policy_approval.PolicyDatumValidationInputs,
  designed: Bool,
  designer_changed: Bool,
  required_asset_valid: Bool,
  fees_paid: Bool,
  designer_settings_valid: Bool,
  is_reset_shape: Bool,
  reset_privacy_inputs: personalize_base.ResetPrivacyInputs,
  signed_by_provider: Bool,
  signed_by_owner: Bool,
  unchanged_when_reset_denied: Bool,
}

pub fn personalize_is_valid(inputs: PersonalizeValidationInputs) -> Bool {
  let common_gates_pass =
    inputs.datum_name_matches_redeemer && inputs.output_has_expected_handle_token && inputs.last_update_address_matches_owner && personalize_base.subhandle_personalization_is_allowed(
      inputs.handle_type,
      inputs.reset,
      inputs.sub_pz_enabled,
      inputs.root_pz_enabled,
      inputs.new_pz_enabled,
    ) && (
      inputs.handle_type == types.HandleTypeVirtualSubhandle || inputs.reset || inputs.owner_handle_present
    ) && (
      personalize_base.resolved_ada_is_allowed(inputs.handle_type) || inputs.resolved_ada_is_empty
    ) && virtual_personalization_rules_are_valid(inputs) && inputs.contract_output_is_valid && inputs.immutables_unchanged && personalize_policy_approval.policy_datum_is_valid(
      inputs.bg_status,
      inputs.pfp_status,
      inputs.policy_datum_inputs,
    )

  common_gates_pass && when inputs.reset is {
    False ->
      personalize_base.non_reset_authorization_is_valid(
        inputs.designed,
        inputs.designer_changed,
        inputs.required_asset_valid,
        inputs.fees_paid,
        inputs.designer_settings_valid,
        inputs.is_reset_shape,
      )
    True ->
      personalize_base.reset_privacy_is_valid(inputs.reset_privacy_inputs) && personalize_base.reset_authorization_is_valid(
        personalize_policy_approval.approvals_are_valid(
          inputs.check_bg_status,
          inputs.check_pfp_status,
        ),
        inputs.required_asset_valid,
        inputs.signed_by_provider,
        inputs.signed_by_owner,
        inputs.is_reset_shape,
        inputs.unchanged_when_reset_denied,
      )
  }
}

fn virtual_personalization_rules_are_valid(
  inputs: PersonalizeValidationInputs,
) -> Bool {
  if inputs.handle_type != types.HandleTypeVirtualSubhandle {
    True
  } else if !inputs.reset && !inputs.virtual_holder_signed {
    False
  } else if !inputs.virtual_resolved_ada_unchanged {
    False
  } else {
    inputs.virtual_payload_unchanged
  }
}

// Inlines `update_is_valid` directly, returning Bool. Avoids constructing the
// 19-field UpdateValidationInputs record in the validator path. The record and
// `update_is_valid` remain `pub` for unit tests; Aiken DCE drops them from the
// perslfc binary because no validator path reaches them after this refactor.
fn update_validate_from_tx(
  old_nft: types.DataMap,
  old_extra: types.DataMap,
  handle: types.Handle,
  root_handle: ByteArray,
  indexes: types.VirtIndexes,
  admin_signed: Bool,
  tx: transaction.Transaction,
) -> Bool {
  expect Some(contract_output) = output_at(tx.outputs, indexes.contract_output)
  let root_output_opt = output_at(tx.outputs, indexes.root_handle)
  let admin_settings_output_opt =
    reference_output_at(tx.reference_inputs, indexes.admin_settings)
  let root_settings_output_opt =
    reference_output_at(tx.reference_inputs, indexes.root_settings)
  expect Some(new_datum_data) = output_data(contract_output, tx)
  expect new_datum: types.PersonalizationDatum = new_datum_data
  let types.Cip68 { nft: new_nft, version: _, extra: new_extra_data } = new_datum
  let new_extra = datum.get_extra(new_extra_data)

  let protocol_settings_present =
    when admin_settings_output_opt is {
      Some(out) ->
        output_has_handle_asset(
          out,
          constants.prefixed_asset_name(constants.lbl_222, "sh_settings"),
        )
      None -> False
    }
  let root_settings_present =
    when root_settings_output_opt is {
      Some(out) ->
        output_has_handle_asset(
          out,
          constants.prefixed_asset_name(constants.lbl_001, root_handle),
        )
      None -> False
    }
  let pz_payload_unchanged =
    pz_payload_without_virtual_and_resolved(old_extra) == pz_payload_without_virtual_and_resolved(new_extra)
  let nft_unchanged = old_nft == new_nft

  // Combined early-False guard: handle_type check (originally in update_is_valid)
  // plus the 4-presence checks (originally the early-return path).
  if handle.handle_type != types.HandleTypeVirtualSubhandle || !protocol_settings_present || !root_settings_present || !pz_payload_unchanged || !nft_unchanged {
    False
  } else {
    expect Some(old_virtual) = parse_virtual_data(old_extra)
    expect Some(new_virtual) = parse_virtual_data(new_extra)
    expect Some(old_address) = parse_resolved_address(old_extra)
    expect Some(new_address) = parse_resolved_address(new_extra)
    expect Some(admin_settings_output) = admin_settings_output_opt
    expect Some(root_settings_output) = root_settings_output_opt
    expect Some(admin_settings_data) = output_data(admin_settings_output, tx)
    // Lean MainSubHandleSettings parse: only 4 of 8 fields are reached by the
    // perslfc Update path. Skipping the unused expects bypasses the cast on
    // valid_contracts / admin_creds / base_price / buy_down_prices.
    expect [
      _,
      _,
      main_virtual_price_data,
      _,
      _,
      main_payment_address_data,
      main_expiry_duration_data,
      main_renewal_window_data,
    ]: List<Data> = admin_settings_data
    expect main_virtual_price: Int = main_virtual_price_data
    expect main_payment_address: ByteArray = main_payment_address_data
    expect main_expiry_duration: Int = main_expiry_duration_data
    expect main_renewal_window: Int = main_renewal_window_data
    expect Some(root_settings_data) = output_data(root_settings_output, tx)
    // Lean OwnerSettings parse: only payment_address + the virtual SubHandleSettings's
    // tier_pricing + public_minting_enabled are reached by the perslfc Update path.
    expect [
      _,
      root_virtual_data,
      _,
      _,
      _,
      _,
      _,
      root_payment_address_data,
    ]: List<Data> = root_settings_data
    expect [
      root_virtual_public_minting_data,
      _,
      root_virtual_tier_pricing_data,
      _,
      _,
    ]: List<Data> = root_virtual_data
    expect root_virtual_public_minting: Int = root_virtual_public_minting_data
    expect root_virtual_tier_pricing: types.IntMatrix =
      root_virtual_tier_pricing_data
    expect root_payment_address: ByteArray = root_payment_address_data

    let old_expiry = datum.int_or(datum.map_get(old_virtual, key_expires_time), 0)
    let new_expiry = datum.int_or(datum.map_get(new_virtual, key_expires_time), 0)
    let valid_from = validity_start(tx)
    let expired =
      when valid_from is {
        Some(start) -> start > old_expiry
        None -> False
      }
    let extended =
      when valid_from is {
        Some(start) ->
          old_expiry + main_expiry_duration == new_expiry && start > old_expiry - main_renewal_window
        None -> False
      }
    let root_signed =
      when root_output_opt is {
        Some(root_output) ->
          output_has_handle_asset(
            root_output,
            constants.prefixed_asset_name(constants.lbl_222, root_handle),
          )
        None -> False
      }
    let assignee_signed_pay =
      signer_matches_payment_credential(tx.extra_signatories, old_address.payment_credential)
    let assignee_signed_stake =
      signer_matches_stake_credential(tx.extra_signatories, old_address.stake_credential)

    let good_main_payment =
      if extended {
        when utils.address_from_shelley_bytes(main_payment_address) is {
          Some(main_payment_address) ->
            value_paid_to_with_handle_datum(
              tx, main_payment_address, handle.name, main_virtual_price,
            )
          None -> False
        }
      } else {
        False
      }
    let good_root_payment =
      if extended {
        let root_price =
          utils.get_virtual_price(
            bytearray.length(handle.name),
            root_virtual_tier_pricing,
          ) - main_virtual_price
        when utils.address_from_shelley_bytes(root_payment_address) is {
          Some(root_payment_address) ->
            value_paid_to_with_handle_datum(
              tx, root_payment_address, handle.name, root_price,
            )
          None -> False
        }
      } else {
        False
      }

    let public_mint =
      datum.int_or(datum.map_get(old_virtual, key_public_mint), 0) != 0
    let address_changed = old_address != new_address
    let address_change_stake_approved =
      old_address.stake_credential == new_address.stake_credential
    let expiry_unchanged = old_expiry == new_expiry
    let new_public_mint_is_private =
      datum.int_or(datum.map_get(new_virtual, key_public_mint), 0) == 0
    let root_virtual_mint_enabled =
      root_virtual_public_minting != 0

    // Inlined `update_is_valid` body — direct computation on local lets.
    if !public_mint && root_signed {
      address_changed || extended && (good_main_payment || admin_signed)
    } else if public_mint && root_signed && expired {
      extended && good_main_payment && new_public_mint_is_private
    } else if assignee_signed_pay || assignee_signed_stake {
      let addr_change_ok =
        !address_changed || address_change_stake_approved && assignee_signed_stake
      addr_change_ok && (
        extended && good_main_payment && good_root_payment || expiry_unchanged
      ) && root_virtual_mint_enabled
    } else {
      False
    }
  }
}

pub fn dispatch_from_tx(
  datum_opt: Option<Data>,
  redeemer: types.Redeemer,
  own_ref: transaction.OutputReference,
  tx: transaction.Transaction,
) -> Bool {
  when datum_opt is {
    Some(old_datum_data) ->
      when load_pz_settings(tx) is {
        Some(settings) -> {
          let admin_signed =
            utils.admin_has_signed_tx(
              settings.admin_creds,
              tx.extra_signatories,
            )

          when redeemer is {
            types.ReturnToSender ->
              return_to_sender.return_to_sender_is_valid(
                tx.outputs,
                admin_signed,
              )

            types.Migrate { handle, output_index } -> {
              expect old_datum: types.PersonalizationDatum = old_datum_data
              let types.Cip68 { nft: _, version: _, extra: old_extra_data } =
                old_datum
              let old_extra = datum.get_extra(old_extra_data)
              let owner_sig_required =
                datum.int_or(
                  datum.map_get(old_extra, key_migrate_sig_required),
                  0,
                ) != 0

              when output_at(tx.outputs, output_index) is {
                Some(output) ->
                  when output_data(output, tx) is {
                    Some(new_datum_data) ->
                      when current_validator_hash(own_ref, tx) is {
                        Some(current_hash) ->
                          migrate.migrate_is_valid(
                            old_datum_data == new_datum_data,
                            output_has_handle_asset(
                              output,
                              constants.prefixed_asset_name(
                                personalize_base.handle_label_for_type(
                                  handle.handle_type,
                                ),
                                handle.name,
                              ),
                            ),
                            utils.is_valid_contract(
                              output,
                              settings.valid_contracts,
                              current_hash,
                            ),
                            migrate.migration_signers_are_valid(
                              admin_signed,
                              owner_sig_required,
                              outputs_have_owner_token(tx.outputs, handle.name),
                            ),
                          )
                        None -> False
                      }
                    None -> False
                  }
                None -> False
              }
            }

            types.Revoke { handle, root_handle, owner_index } -> {
              expect old_datum: types.PersonalizationDatum = old_datum_data
              let types.Cip68 { nft: _, version: _, extra: old_extra_data } =
                old_datum
              let old_extra = datum.get_extra(old_extra_data)

              when parse_virtual_data(old_extra) is {
                Some(old_virtual) -> {
                  let old_expiry =
                    datum.int_or(
                      datum.map_get(old_virtual, key_expires_time),
                      0,
                    )
                  let expired =
                    when validity_start(tx) is {
                      Some(start) -> start > old_expiry
                      None -> False
                    }
                  let root_signed =
                    when output_at(tx.outputs, owner_index) is {
                      Some(root_output) ->
                        output_has_handle_asset(
                          root_output,
                          constants.prefixed_asset_name(
                            constants.lbl_222,
                            root_handle,
                          ),
                        )
                      None -> False
                    }

                  revoke.revoke_is_valid(
                    handle.handle_type,
                    datum.int_or(datum.map_get(old_virtual, key_public_mint), 0) != 0,
                    root_signed,
                    expired,
                    assets.quantity_of(
                      tx.mint,
                      constants.handle_policy_id,
                      constants.prefixed_asset_name(
                        constants.lbl_000,
                        handle.name,
                      ),
                    ),
                  )
                }
                None -> False
              }
            }

            types.Update { handle, root_handle, indexes } -> {
              expect old_datum: types.PersonalizationDatum = old_datum_data
              let types.Cip68 {
                nft: old_nft,
                version: _,
                extra: old_extra_data,
              } = old_datum
              let old_extra = datum.get_extra(old_extra_data)
              update_validate_from_tx(
                old_nft,
                old_extra,
                handle,
                root_handle,
                indexes,
                admin_signed,
                tx,
              )
            }

            types.Personalize { handle, root_handle: _, indexes, designer, reset } -> {
              let types.PzSettings {
                treasury_fee,
                treasury_cred,
                pz_min_fee,
                pz_providers,
                valid_contracts,
                admin_creds: _,
                settings_cred,
                grace_period,
                subhandle_share_percent,
              } = settings
              personalize_validate(
                handle,
                indexes,
                designer,
                treasury_fee,
                treasury_cred,
                pz_min_fee,
                pz_providers,
                valid_contracts,
                settings_cred,
                grace_period,
                subhandle_share_percent,
                own_ref,
                reset != 0,
                old_datum_data,
                tx,
              )
            }
          }
        }
        None -> False
      }
    None -> False
  }
}

// Per-variant dispatch helpers — used by the split-by-redeemer validators
// (pers_logic_personalize.ak, pers_logic_other.ak). Each handles only its
// declared variants; the catchall `_ -> False` lets Aiken DCE branches the
// validator never serves, so each split script stays well under max_tx_size.

pub fn dispatch_personalize_from_tx(
  datum_opt: Option<Data>,
  redeemer: types.Redeemer,
  own_ref: transaction.OutputReference,
  tx: transaction.Transaction,
) -> Bool {
  expect Some(old_datum_data) = datum_opt
  expect Some(
    (
      treasury_fee,
      treasury_cred,
      pz_min_fee,
      pz_providers,
      valid_contracts,
      settings_cred,
      grace_period,
      subhandle_share_percent,
    ),
  ) = load_pz_settings_for_personalize(tx)
  when redeemer is {
    types.Personalize { handle, root_handle: _, indexes, designer, reset } -> {
      let r = reset != 0
      // Non-reset txs delegate designer_settings validation to persdsg.
      // Reset txs skip designer_settings (Helios semantics).
      let dsg_ok = r || persdsg_observed_for_personalize(tx, own_ref, redeemer)
      dsg_ok && personalize_validate(
        handle,
        indexes,
        designer,
        treasury_fee,
        treasury_cred,
        pz_min_fee,
        pz_providers,
        valid_contracts,
        settings_cred,
        grace_period,
        subhandle_share_percent,
        own_ref,
        r,
        old_datum_data,
        tx,
      )
    }
    _ -> False
  }
}

pub fn dispatch_other_from_tx(
  datum_opt: Option<Data>,
  redeemer: types.Redeemer,
  own_ref: transaction.OutputReference,
  tx: transaction.Transaction,
) -> Bool {
  expect Some(old_datum_data) = datum_opt
  expect Some(settings) = load_pz_settings(tx)
  let admin_signed =
    utils.admin_has_signed_tx(settings.admin_creds, tx.extra_signatories)
  // ReturnToSender doesn't need the old_datum, so dispatch it first; the other
  // 3 redeemers all share the same Cip68 destructure, so lift it once.
  when redeemer is {
    types.ReturnToSender ->
      return_to_sender.return_to_sender_is_valid(tx.outputs, admin_signed)
    _ -> {
      expect old_datum: types.PersonalizationDatum = old_datum_data
      let types.Cip68 {
        nft: old_nft,
        version: _,
        extra: old_extra_data,
      } = old_datum
      let old_extra = datum.get_extra(old_extra_data)
      when redeemer is {
        types.Migrate { handle, output_index } -> {
          let owner_sig_required =
            datum.int_or(datum.map_get(old_extra, key_migrate_sig_required), 0) != 0
          expect Some(output) = output_at(tx.outputs, output_index)
          expect Some(new_datum_data) = output_data(output, tx)
          expect Some(current_hash) = current_validator_hash(own_ref, tx)
          // Inlined migrate_is_valid + migration_signers_are_valid (single
          // call sites in perslfc binary).
          and {
            old_datum_data == new_datum_data,
            output_has_handle_asset(
              output,
              constants.prefixed_asset_name(
                personalize_base.handle_label_for_type(handle.handle_type),
                handle.name,
              ),
            ),
            utils.is_valid_contract(output, settings.valid_contracts, current_hash),
            admin_signed,
            !owner_sig_required || outputs_have_owner_token(tx.outputs, handle.name),
          }
        }
        types.Revoke { handle, root_handle, owner_index } -> {
          expect Some(old_virtual) = parse_virtual_data(old_extra)
          let old_expiry =
            datum.int_or(datum.map_get(old_virtual, key_expires_time), 0)
          let expired =
            when validity_start(tx) is {
              Some(start) -> start > old_expiry
              None -> False
            }
          let root_signed =
            when output_at(tx.outputs, owner_index) is {
              Some(root_output) ->
                output_has_handle_asset(
                  root_output,
                  constants.prefixed_asset_name(constants.lbl_222, root_handle),
                )
              None -> False
            }
          // Inlined revoke_is_valid (single call site in perslfc binary).
          if handle.handle_type != types.HandleTypeVirtualSubhandle {
            False
          } else {
            let public_mint =
              datum.int_or(datum.map_get(old_virtual, key_public_mint), 0) != 0
            ( !public_mint && root_signed || public_mint && expired ) && assets.quantity_of(
              tx.mint,
              constants.handle_policy_id,
              constants.prefixed_asset_name(constants.lbl_000, handle.name),
            ) == -1
          }
        }
        types.Update { handle, root_handle, indexes } ->
          update_validate_from_tx(
            old_nft,
            old_extra,
            handle,
            root_handle,
            indexes,
            admin_signed,
            tx,
          )
        _ -> False
      }
    }
  }
}

// Observer-level entry points for each split. Each verifies the spend-redeemer
// matches the observer-carried redeemer, finds the spend input, and dispatches
// to its variant-specific helper.
pub fn validate_observer_personalize_data(
  observer_redeemer_data: Data,
  tx: transaction.Transaction,
) -> Bool {
  when observe_redeemer_fields(observer_redeemer_data) is {
    None -> False
    Some(Pair(own_ref, redeemer_data)) -> {
      expect redeemer: types.Redeemer = redeemer_data
      spend_redeemer_data_matches(tx.redeemers, own_ref, redeemer_data) && when
        transaction.find_input(tx.inputs, own_ref)
      is {
        Some(input) ->
          dispatch_personalize_from_tx(output_data(input.output, tx), redeemer, own_ref, tx)
        None -> False
      }
    }
  }
}

pub fn validate_observer_other_data(
  observer_redeemer_data: Data,
  tx: transaction.Transaction,
) -> Bool {
  when observe_redeemer_fields(observer_redeemer_data) is {
    None -> False
    Some(Pair(own_ref, redeemer_data)) -> {
      expect redeemer: types.Redeemer = redeemer_data
      spend_redeemer_data_matches(tx.redeemers, own_ref, redeemer_data) && when
        transaction.find_input(tx.inputs, own_ref)
      is {
        Some(input) ->
          dispatch_other_from_tx(output_data(input.output, tx), redeemer, own_ref, tx)
        None -> False
      }
    }
  }
}

// Designer-settings observer entry. Validates designer_settings for the
// Personalize redeemer (reset=False) only. Other redeemers and reset=True
// short-circuit to True; perspz handles non-designer-settings logic locally.
pub fn validate_observer_designer_settings_data(
  observer_redeemer_data: Data,
  tx: transaction.Transaction,
) -> Bool {
  when observe_redeemer_fields(observer_redeemer_data) is {
    None -> False
    Some(Pair(own_ref, redeemer_data)) -> {
      expect redeemer: types.Redeemer = redeemer_data
      spend_redeemer_data_matches(tx.redeemers, own_ref, redeemer_data) && when
        transaction.find_input(tx.inputs, own_ref)
      is {
        Some(input) ->
          dispatch_designer_settings_from_tx(output_data(input.output, tx), redeemer, tx)
        None -> False
      }
    }
  }
}

fn dispatch_designer_settings_from_tx(
  datum_opt: Option<Data>,
  redeemer: types.Redeemer,
  tx: transaction.Transaction,
) -> Bool {
  expect Some(_old_datum_data) = datum_opt
  when redeemer is {
    types.Personalize { handle: _, root_handle: _, indexes, designer, reset } ->
      // Reset path doesn't validate designer_settings (Helios semantics);
      // perspz only requires this observer for non-reset txs.
      if reset != 0 {
        True
      } else {
        when output_at(tx.outputs, indexes.contract_output) is {
          None -> False
          Some(contract_output) ->
            when output_data(contract_output, tx) is {
              None -> False
              Some(new_datum_data) -> {
                expect new_datum: types.PersonalizationDatum = new_datum_data
                let types.Cip68 { nft: _, version: _, extra: new_extra_data } =
                  new_datum
                let new_extra = datum.get_extra(new_extra_data)
                let new_bg_asset =
                  personalize_mpf_context.asset_from_extra(new_extra, key_bg_asset)
                let bg_cip68_opt =
                  cip68_ref_for_asset(new_bg_asset, indexes.bg_datum, tx)
                designer_settings_valid_for_personalize(
                  designer,
                  bg_cip68_opt,
                  new_extra,
                )
              }
            }
        }
      }
    _ -> False
  }
}


test update_is_valid_rejects_non_virtual_handles() {
  and {
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeHandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeNftSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
  }
}

test update_is_valid_requires_settings_tokens_and_restricted_payload() {
  and {
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: False,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: False,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: False,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: False,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
  }
}

test update_is_valid_private_root_signed_branch() {
  and {
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: True,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: True,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: False,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
  }
}

test update_is_valid_public_root_signed_expired_branch() {
  and {
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: True,
        expired: True,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: True,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: True,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: True,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: True,
        expired: True,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
  }
}

test update_is_valid_assignee_branch() {
  and {
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: False,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: True,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: False,
        expired: False,
        address_changed: True,
        address_change_stake_approved: True,
        assignee_signed_pay: False,
        assignee_signed_stake: True,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: True,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: False,
        expired: False,
        address_changed: True,
        address_change_stake_approved: False,
        assignee_signed_pay: False,
        assignee_signed_stake: True,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: False,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: True,
        assignee_signed_stake: False,
        extended: True,
        expiry_unchanged: False,
        good_main_payment: True,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: True,
      },
    ),
    !update_is_valid(
      UpdateValidationInputs {
        handle_type: types.HandleTypeVirtualSubhandle,
        protocol_settings_present: True,
        root_settings_present: True,
        pz_payload_unchanged: True,
        nft_unchanged: True,
        public_mint: True,
        root_signed: False,
        expired: False,
        address_changed: False,
        address_change_stake_approved: False,
        assignee_signed_pay: True,
        assignee_signed_stake: False,
        extended: False,
        expiry_unchanged: True,
        good_main_payment: False,
        good_root_payment: False,
        admin_signed: False,
        new_public_mint_is_private: False,
        root_virtual_mint_enabled: False,
      },
    ),
  }
}

test update_is_valid_rejects_without_any_valid_signature_path() {
  !update_is_valid(
    UpdateValidationInputs {
      handle_type: types.HandleTypeVirtualSubhandle,
      protocol_settings_present: True,
      root_settings_present: True,
      pz_payload_unchanged: True,
      nft_unchanged: True,
      public_mint: True,
      root_signed: False,
      expired: False,
      address_changed: False,
      address_change_stake_approved: False,
      assignee_signed_pay: False,
      assignee_signed_stake: False,
      extended: False,
      expiry_unchanged: True,
      good_main_payment: False,
      good_root_payment: False,
      admin_signed: False,
      new_public_mint_is_private: False,
      root_virtual_mint_enabled: True,
    },
  )
}

fn fixture_personalize_inputs(
  handle_type: types.HandleType,
  reset: Bool,
) -> PersonalizeValidationInputs {
  PersonalizeValidationInputs {
    handle_type,
    reset,
    datum_name_matches_redeemer: True,
    output_has_expected_handle_token: True,
    last_update_address_matches_owner: True,
    owner_handle_present: True,
    resolved_ada_is_empty: True,
    sub_pz_enabled: True,
    root_pz_enabled: True,
    new_pz_enabled: True,
    virtual_holder_signed: True,
    virtual_resolved_ada_unchanged: True,
    virtual_payload_unchanged: True,
    contract_output_is_valid: True,
    immutables_unchanged: True,
    bg_status: personalize_policy_approval.ApprovalNotRequired,
    pfp_status: personalize_policy_approval.ApprovalNotRequired,
    check_bg_status: personalize_policy_approval.ApprovalNotRequired,
    check_pfp_status: personalize_policy_approval.ApprovalNotRequired,
    policy_datum_inputs: personalize_policy_approval.PolicyDatumValidationInputs {
      validated_by_present: False,
      validated_by_signed: False,
      expected_nsfw: 0,
      bg_asset_set: False,
      pfp_asset_set: False,
      bg_image_set: False,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
    designed: True,
    designer_changed: True,
    required_asset_valid: True,
    fees_paid: True,
    designer_settings_valid: True,
    is_reset_shape: False,
    reset_privacy_inputs: personalize_base.ResetPrivacyInputs {
      holder_changed: False,
      signed_by_provider: False,
      signed_by_owner: False,
      socials_cleared: True,
      resolved_addresses_cleared: True,
      socials_unchanged: True,
      resolved_addresses_unchanged: True,
    },
    signed_by_provider: False,
    signed_by_owner: False,
    unchanged_when_reset_denied: True,
  }
}

test personalize_is_valid_non_reset_designer_change_branch() {
  let base = fixture_personalize_inputs(types.HandleTypeHandle, False)

  and {
    personalize_is_valid(base),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, required_asset_valid: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, fees_paid: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, designer_settings_valid: False },
    ),
  }
}

test personalize_is_valid_non_reset_designer_unchanged_or_reset_shape_branch() {
  let base = fixture_personalize_inputs(types.HandleTypeHandle, False)

  and {
    personalize_is_valid(
      PersonalizeValidationInputs { ..base, designer_changed: False },
    ),
    personalize_is_valid(
      PersonalizeValidationInputs {
        ..base,
        designed: False,
        designer_changed: False,
        is_reset_shape: True,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..base,
        designed: False,
        designer_changed: False,
        is_reset_shape: False,
      },
    ),
  }
}

test personalize_is_valid_common_and_virtual_gates() {
  let base = fixture_personalize_inputs(types.HandleTypeHandle, False)
  let virtual_base =
    fixture_personalize_inputs(types.HandleTypeVirtualSubhandle, False)

  and {
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, datum_name_matches_redeemer: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..fixture_personalize_inputs(types.HandleTypeNftSubhandle, False),
        sub_pz_enabled: False,
        root_pz_enabled: False,
        new_pz_enabled: False,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, owner_handle_present: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, resolved_ada_is_empty: False },
    ),
    personalize_is_valid(
      PersonalizeValidationInputs {
        ..virtual_base,
        resolved_ada_is_empty: False,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..virtual_base,
        virtual_holder_signed: False,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..virtual_base,
        virtual_resolved_ada_unchanged: False,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..virtual_base,
        virtual_payload_unchanged: False,
      },
    ),
  }
}

test personalize_is_valid_rejects_contract_or_policy_failures() {
  let base = fixture_personalize_inputs(types.HandleTypeHandle, False)

  and {
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, contract_output_is_valid: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs { ..base, immutables_unchanged: False },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..base,
        bg_status: personalize_policy_approval.ApprovalRejected,
      },
    ),
  }
}

test personalize_is_valid_reset_privacy_and_authorization_branches() {
  let reset_base =
    PersonalizeValidationInputs {
      ..fixture_personalize_inputs(types.HandleTypeHandle, True),
      designed: False,
      designer_changed: False,
      is_reset_shape: True,
    }

  and {
    personalize_is_valid(
      PersonalizeValidationInputs { ..reset_base, signed_by_provider: True },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..reset_base,
        signed_by_provider: True,
        is_reset_shape: False,
      },
    ),
    personalize_is_valid(
      PersonalizeValidationInputs {
        ..reset_base,
        signed_by_provider: False,
        signed_by_owner: False,
        unchanged_when_reset_denied: True,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..reset_base,
        signed_by_provider: False,
        signed_by_owner: False,
        unchanged_when_reset_denied: False,
      },
    ),
    !personalize_is_valid(
      PersonalizeValidationInputs {
        ..reset_base,
        reset_privacy_inputs: personalize_base.ResetPrivacyInputs {
          holder_changed: True,
          signed_by_provider: False,
          signed_by_owner: False,
          socials_cleared: False,
          resolved_addresses_cleared: True,
          socials_unchanged: False,
          resolved_addresses_unchanged: False,
        },
      },
    ),
  }
}

fn fixture_update_inputs() -> UpdateValidationInputs {
  UpdateValidationInputs {
    handle_type: types.HandleTypeVirtualSubhandle,
    protocol_settings_present: True,
    root_settings_present: True,
    pz_payload_unchanged: True,
    nft_unchanged: True,
    public_mint: False,
    root_signed: True,
    expired: False,
    address_changed: True,
    address_change_stake_approved: False,
    assignee_signed_pay: False,
    assignee_signed_stake: False,
    extended: False,
    expiry_unchanged: True,
    good_main_payment: False,
    good_root_payment: False,
    admin_signed: True,
    new_public_mint_is_private: False,
    root_virtual_mint_enabled: True,
  }
}


fn fixture_settings() -> types.PzSettings {
  types.PzSettings {
    treasury_fee: 0,
    treasury_cred: #"aa",
    pz_min_fee: 0,
    pz_providers: [],
    valid_contracts: [#"bbbb"],
    admin_creds: [utils.bootstrap_admin_signer],
    settings_cred: #"bb",
    grace_period: 0,
    subhandle_share_percent: 0,
  }
}

fn fixture_script_output(
  script_hash: ByteArray,
  value: assets.Value,
  datum: transaction.Datum,
) -> transaction.Output {
  transaction.Output {
    address: address.from_script(script_hash),
    value,
    datum,
    reference_script: None,
  }
}

fn fixture_reference_input_for_settings() -> transaction.Input {
  let settings = fixture_settings()
  let settings_data: Data = settings
  let value =
    assets.from_asset(
      constants.handle_policy_id,
      constants.pz_handle_asset_name,
      1,
    )

  transaction.Input {
    output_reference: transaction.OutputReference {
      transaction_id: #"0101010101010101010101010101010101010101010101010101010101010101",
      output_index: 0,
    },
    output: fixture_script_output(
      settings.settings_cred,
      value,
      transaction.InlineDatum(settings_data),
    ),
  }
}

fn fixture_old_datum_data() -> Data {
  let datum_data: Data =
    types.Cip68 { nft: [], version: 0, extra: datum.empty_data }
  datum_data
}

fn fixture_own_ref() -> transaction.OutputReference {
  transaction.OutputReference {
    transaction_id: #"0202020202020202020202020202020202020202020202020202020202020202",
    output_index: 0,
  }
}

fn fixture_tx_for_dispatch_from_tx(
  admin_signed: Bool,
  outputs: List<transaction.Output>,
) -> transaction.Transaction {
  fixture_tx_for_dispatch_from_tx_full(
    admin_signed,
    outputs,
    [fixture_reference_input_for_settings()],
    assets.zero,
    transaction.placeholder.validity_range,
  )
}

fn fixture_tx_for_dispatch_from_tx_full(
  admin_signed: Bool,
  outputs: List<transaction.Output>,
  reference_inputs: List<transaction.Input>,
  mint: assets.Value,
  validity_range: transaction.ValidityRange,
) -> transaction.Transaction {
  let own_ref = fixture_own_ref()
  let own_input =
    transaction.Input {
      output_reference: own_ref,
      output: fixture_script_output(#"bbbb", assets.zero, transaction.NoDatum),
    }

  transaction.Transaction {
    ..transaction.placeholder,
    inputs: [own_input],
    reference_inputs,
    outputs,
    mint,
    validity_range,
    extra_signatories: if admin_signed {
      [utils.bootstrap_admin_signer]
    } else {
      []
    },
  }
}

test dispatch_from_tx_return_to_sender_uses_settings_admin_gate() {
  let safe_output =
    transaction.Output {
      address: address.from_verification_key(#"01"),
      value: assets.zero,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let old_datum_data = fixture_old_datum_data()
  let own_ref = fixture_own_ref()

  and {
    dispatch_from_tx(
      Some(old_datum_data),
      types.ReturnToSender,
      own_ref,
      fixture_tx_for_dispatch_from_tx(True, [safe_output]),
    ),
    !dispatch_from_tx(
      Some(old_datum_data),
      types.ReturnToSender,
      own_ref,
      fixture_tx_for_dispatch_from_tx(False, [safe_output]),
    ),
  }
}

test dispatch_from_tx_return_to_sender_rejects_forbidden_assets() {
  let forbidden_value =
    assets.from_asset(
      constants.handle_policy_id,
      constants.prefixed_asset_name(constants.lbl_100, "alice"),
      1,
    )
  let forbidden_output =
    transaction.Output {
      address: address.from_verification_key(#"01"),
      value: forbidden_value,
      datum: transaction.NoDatum,
      reference_script: None,
    }

  !dispatch_from_tx(
    Some(fixture_old_datum_data()),
    types.ReturnToSender,
    fixture_own_ref(),
    fixture_tx_for_dispatch_from_tx(True, [forbidden_output]),
  )
}

fn fixture_enterprise_address(payment_hash: ByteArray) -> ByteArray {
  bytearray.concat(#"60", payment_hash)
}

fn fixture_cip68_with_extra(extra: Data) -> Data {
  let datum_data: Data = types.Cip68 { nft: [], version: 0, extra }

  datum_data
}

fn fixture_reference_input(
  tx_id: ByteArray,
  output_index: Int,
  output: transaction.Output,
) -> transaction.Input {
  transaction.Input {
    output_reference: transaction.OutputReference {
      transaction_id: tx_id,
      output_index,
    },
    output,
  }
}

fn fixture_subhandle_settings(
  public_minting_enabled: Int,
  tier_price: Int,
) -> types.SubHandleSettings {
  types.SubHandleSettings {
    public_minting_enabled,
    pz_enabled: 1,
    tier_pricing: [[1, tier_price]],
    default_styles: datum.empty_data,
    save_original_address: 0,
  }
}

fn fixture_main_settings(
  payment_address: ByteArray,
) -> types.MainSubHandleSettings {
  types.MainSubHandleSettings {
    valid_contracts: [#"bbbb"],
    admin_creds: [utils.bootstrap_admin_signer],
    virtual_price: 4000000,
    base_price: 0,
    buy_down_prices: [[1, 0]],
    payment_address,
    expiry_duration: 600,
    renewal_window: 300,
  }
}

fn fixture_owner_settings(payment_address: ByteArray) -> types.OwnerSettings {
  types.OwnerSettings {
    nft: fixture_subhandle_settings(1, 0),
    virtual: fixture_subhandle_settings(1, 7000000),
    buy_down_price: 0,
    buy_down_paid: 0,
    buy_down_percent: 0,
    agreed_terms: "",
    migrate_sig_required: 0,
    payment_address,
  }
}

test dispatch_from_tx_migrate_branch_respects_owner_sig_requirement() {
  let handle =
    types.Handle { handle_type: types.HandleTypeHandle, name: "alice" }
  let own_ref = fixture_own_ref()
  let ok_output =
    fixture_script_output(
      #"bbbb",
      assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_100, handle.name),
        1,
      ),
      transaction.InlineDatum(fixture_old_datum_data()),
    )
  let owner_sig_extra: Data = [Pair(key_migrate_sig_required, 1)]
  let owner_sig_datum = fixture_cip68_with_extra(owner_sig_extra)
  let blocked_output =
    fixture_script_output(
      #"bbbb",
      assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_100, handle.name),
        1,
      ),
      transaction.InlineDatum(owner_sig_datum),
    )

  and {
    dispatch_from_tx(
      Some(fixture_old_datum_data()),
      types.Migrate { handle, output_index: 0 },
      own_ref,
      fixture_tx_for_dispatch_from_tx(True, [ok_output]),
    ),
    !dispatch_from_tx(
      Some(owner_sig_datum),
      types.Migrate { handle, output_index: 0 },
      own_ref,
      fixture_tx_for_dispatch_from_tx(True, [blocked_output]),
    ),
  }
}

test dispatch_from_tx_revoke_branch_uses_mint_burn_quantity() {
  let handle =
    types.Handle {
      handle_type: types.HandleTypeVirtualSubhandle,
      name: "alice",
    }
  let root_handle = "root"
  let virtual_data: Data =
    [Pair(key_public_mint, 0), Pair(key_expires_time, 5000)]
  let old_datum_data =
    fixture_cip68_with_extra([Pair(key_virtual, virtual_data)])
  let root_output =
    transaction.Output {
      address: address.from_verification_key(#"01"),
      value: assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_222, root_handle),
        1,
      ),
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let burned_virtual =
    assets.from_asset(
      constants.handle_policy_id,
      constants.prefixed_asset_name(constants.lbl_000, handle.name),
      -1,
    )
  let tx_for_revoke =
    fixture_tx_for_dispatch_from_tx_full(
      False,
      [root_output],
      [fixture_reference_input_for_settings()],
      burned_virtual,
      interval.after(10),
    )
  let tx_without_burn =
    fixture_tx_for_dispatch_from_tx_full(
      False,
      [root_output],
      [fixture_reference_input_for_settings()],
      assets.zero,
      interval.after(10),
    )
  let redeemer = types.Revoke { handle, root_handle, owner_index: 0 }

  and {
    dispatch_from_tx(
      Some(old_datum_data),
      redeemer,
      fixture_own_ref(),
      tx_for_revoke,
    ),
    !dispatch_from_tx(
      Some(old_datum_data),
      redeemer,
      fixture_own_ref(),
      tx_without_burn,
    ),
  }
}

test dispatch_from_tx_update_branch_requires_settings_tokens() {
  let handle =
    types.Handle {
      handle_type: types.HandleTypeVirtualSubhandle,
      name: "alice",
    }
  let indexes =
    types.VirtIndexes {
      admin_settings: 0,
      root_settings: 0,
      contract_output: 0,
      root_handle: 0,
    }
  let output =
    fixture_script_output(
      #"bbbb",
      assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_000, handle.name),
        1,
      ),
      transaction.InlineDatum(fixture_old_datum_data()),
    )

  !dispatch_from_tx(
    Some(fixture_old_datum_data()),
    types.Update { handle, root_handle: "root", indexes },
    fixture_own_ref(),
    fixture_tx_for_dispatch_from_tx(False, [output]),
  )
}

test dispatch_from_tx_update_branch_accepts_private_root_address_change() {
  let handle =
    types.Handle {
      handle_type: types.HandleTypeVirtualSubhandle,
      name: "alice",
    }
  let root_handle = "root"
  let indexes =
    types.VirtIndexes {
      admin_settings: 1,
      root_settings: 2,
      contract_output: 1,
      root_handle: 0,
    }
  let old_virtual: Data =
    [Pair(key_public_mint, 0), Pair(key_expires_time, 1000)]
  let new_virtual: Data =
    [Pair(key_public_mint, 0), Pair(key_expires_time, 1000)]
  let old_resolved: Data =
    [
      Pair(
        key_ada,
        fixture_enterprise_address(
          #"11111111111111111111111111111111111111111111111111111111",
        ),
      ),
    ]
  let new_resolved: Data =
    [
      Pair(
        key_ada,
        fixture_enterprise_address(
          #"22222222222222222222222222222222222222222222222222222222",
        ),
      ),
    ]
  let old_datum_data =
    fixture_cip68_with_extra(
      [
        Pair(key_virtual, old_virtual),
        Pair(key_resolved_addresses, old_resolved),
      ],
    )
  let new_datum_data =
    fixture_cip68_with_extra(
      [
        Pair(key_virtual, new_virtual),
        Pair(key_resolved_addresses, new_resolved),
      ],
    )
  let root_output =
    transaction.Output {
      address: address.from_verification_key(#"01"),
      value: assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_222, root_handle),
        1,
      ),
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let contract_output =
    fixture_script_output(
      #"bbbb",
      assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_000, handle.name),
        1,
      ),
      transaction.InlineDatum(new_datum_data),
    )
  let main_settings_data: Data =
    fixture_main_settings(
      fixture_enterprise_address(
        #"33333333333333333333333333333333333333333333333333333333",
      ),
    )
  let root_settings_data: Data =
    fixture_owner_settings(
      fixture_enterprise_address(
        #"44444444444444444444444444444444444444444444444444444444",
      ),
    )
  let admin_settings_input =
    fixture_reference_input(
      #"0303030303030303030303030303030303030303030303030303030303030303",
      1,
      fixture_script_output(
        #"cccc",
        assets.from_asset(
          constants.handle_policy_id,
          constants.prefixed_asset_name(constants.lbl_222, "sh_settings"),
          1,
        ),
        transaction.InlineDatum(main_settings_data),
      ),
    )
  let root_settings_input =
    fixture_reference_input(
      #"0404040404040404040404040404040404040404040404040404040404040404",
      2,
      fixture_script_output(
        #"dddd",
        assets.from_asset(
          constants.handle_policy_id,
          constants.prefixed_asset_name(constants.lbl_001, root_handle),
          1,
        ),
        transaction.InlineDatum(root_settings_data),
      ),
    )
  let tx_for_update =
    fixture_tx_for_dispatch_from_tx_full(
      False,
      [root_output, contract_output],
      [
        fixture_reference_input_for_settings(),
        admin_settings_input,
        root_settings_input,
      ],
      assets.zero,
      interval.after(900),
    )

  dispatch_from_tx(
    Some(old_datum_data),
    types.Update { handle, root_handle, indexes },
    fixture_own_ref(),
    tx_for_update,
  )
}

test personalize_context_from_tx_requires_inline_contract_datum() {
  let indexes =
    types.PzIndexes {
      pfp_approver: 0,
      bg_approver: 0,
      pfp_datum: 0,
      bg_datum: 0,
      required_asset: 0,
      owner_settings: 0,
      contract_output: 0,
      pz_assets: 0,
      provider_fee: 0,
    }
  let output = fixture_script_output(#"bbbb", assets.zero, transaction.NoDatum)

  when
    personalize_context_from_tx(
      fixture_old_datum_data(),
      indexes,
      False,
      fixture_tx_for_dispatch_from_tx(True, [output]),
    )
  is {
    Some(_) -> False
    None -> True
  }
}

test dispatch_from_tx_personalize_branch_is_wired_through_context_parser() {
  let handle =
    types.Handle { handle_type: types.HandleTypeHandle, name: "alice" }
  let indexes =
    types.PzIndexes {
      pfp_approver: 0,
      bg_approver: 0,
      pfp_datum: 0,
      bg_datum: 0,
      required_asset: 0,
      owner_settings: 0,
      contract_output: 0,
      pz_assets: 0,
      provider_fee: 0,
    }
  let output =
    fixture_script_output(
      #"bbbb",
      assets.from_asset(
        constants.handle_policy_id,
        constants.prefixed_asset_name(constants.lbl_100, handle.name),
        1,
      ),
      transaction.InlineDatum(fixture_old_datum_data()),
    )

  !dispatch_from_tx(
    Some(fixture_old_datum_data()),
    types.Personalize {
      handle,
      root_handle: "root",
      indexes,
      designer: [],
      reset: 0,
    },
    fixture_own_ref(),
    fixture_tx_for_dispatch_from_tx(True, [output]),
  )
}

// ----- persdsg_observed_for_personalize tests -----
//
// perspz delegates designer_settings validation to persdsg via a withdraw
// observer. For non-reset Personalize txs, perspz must verify persdsg fired
// with a matching observer-redeemer (Observe { own_ref, redeemer }) and a
// 0-lovelace withdrawal at persdsg's reward address. These tests exercise
// the gate function directly (it's a private helper).

fn fixture_personalize_redeemer() -> types.Redeemer {
  types.Personalize {
    handle: types.Handle {
      handle_type: types.HandleTypeHandle,
      name: "alice",
    },
    root_handle: "root",
    indexes: types.PzIndexes {
      pfp_approver: 0,
      bg_approver: 0,
      pfp_datum: 0,
      bg_datum: 0,
      required_asset: 0,
      owner_settings: 0,
      contract_output: 0,
      pz_assets: 0,
      provider_fee: 0,
    },
    designer: [],
    reset: 0,
  }
}

fn fixture_persdsg_observer_redeemer_data(
  own_ref: transaction.OutputReference,
  redeemer: types.Redeemer,
) -> Data {
  let own_ref_data: Data = own_ref
  let redeemer_data: Data = redeemer
  builtin.constr_data(0, [own_ref_data, redeemer_data])
}

fn fixture_persdsg_credential() -> address.Credential {
  address.Script(persdsg_hash)
}

fn fixture_tx_with_persdsg_observation(
  own_ref: transaction.OutputReference,
  redeemer: types.Redeemer,
  withdrawal_amount: Int,
  observer_credential: address.Credential,
  observer_redeemer_data: Data,
) -> transaction.Transaction {
  transaction.Transaction {
    ..transaction.placeholder,
    redeemers: [Pair(transaction.Withdraw(observer_credential), observer_redeemer_data)],
    withdrawals: [Pair(observer_credential, withdrawal_amount)],
  }
}

test persdsg_observed_for_personalize_accepts_matching_withdrawal_and_redeemer() {
  let own_ref = fixture_own_ref()
  let redeemer = fixture_personalize_redeemer()
  let observer_data = fixture_persdsg_observer_redeemer_data(own_ref, redeemer)
  let tx =
    fixture_tx_with_persdsg_observation(
      own_ref,
      redeemer,
      0,
      fixture_persdsg_credential(),
      observer_data,
    )
  persdsg_observed_for_personalize(tx, own_ref, redeemer)
}

test persdsg_observed_for_personalize_rejects_when_withdrawal_missing() {
  let own_ref = fixture_own_ref()
  let redeemer = fixture_personalize_redeemer()
  let observer_data = fixture_persdsg_observer_redeemer_data(own_ref, redeemer)
  // Tx has the redeemer entry but tx.withdrawals is empty.
  let tx =
    transaction.Transaction {
      ..transaction.placeholder,
      redeemers: [Pair(
        transaction.Withdraw(fixture_persdsg_credential()),
        observer_data,
      )],
      withdrawals: [],
    }
  !persdsg_observed_for_personalize(tx, own_ref, redeemer)
}

test persdsg_observed_for_personalize_rejects_when_credential_mismatch() {
  let own_ref = fixture_own_ref()
  let redeemer = fixture_personalize_redeemer()
  let observer_data = fixture_persdsg_observer_redeemer_data(own_ref, redeemer)
  // Withdrawal exists but at a DIFFERENT credential, not persdsg's.
  let wrong_credential =
    address.Script(#"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
  let tx =
    fixture_tx_with_persdsg_observation(
      own_ref,
      redeemer,
      0,
      wrong_credential,
      observer_data,
    )
  !persdsg_observed_for_personalize(tx, own_ref, redeemer)
}

test persdsg_observed_for_personalize_rejects_when_observer_redeemer_mismatch() {
  let own_ref = fixture_own_ref()
  let redeemer = fixture_personalize_redeemer()
  // Observer redeemer references a DIFFERENT own_ref — could happen if a
  // malicious BFF tried to point persdsg at a different spend.
  let other_own_ref =
    transaction.OutputReference {
      transaction_id: #"0303030303030303030303030303030303030303030303030303030303030303",
      output_index: 1,
    }
  let mismatched_observer_data =
    fixture_persdsg_observer_redeemer_data(other_own_ref, redeemer)
  let tx =
    fixture_tx_with_persdsg_observation(
      own_ref,
      redeemer,
      0,
      fixture_persdsg_credential(),
      mismatched_observer_data,
    )
  !persdsg_observed_for_personalize(tx, own_ref, redeemer)
}

test dispatch_designer_settings_from_tx_short_circuits_on_reset() {
  // Reset=1 path: persdsg returns True trivially. perspz handles reset's
  // own validation; persdsg doesn't enforce designer_settings on reset.
  let reset_redeemer =
    types.Personalize {
      handle: types.Handle {
        handle_type: types.HandleTypeHandle,
        name: "alice",
      },
      root_handle: "root",
      indexes: types.PzIndexes {
        pfp_approver: 0,
        bg_approver: 0,
        pfp_datum: 0,
        bg_datum: 0,
        required_asset: 0,
        owner_settings: 0,
        contract_output: 0,
        pz_assets: 0,
        provider_fee: 0,
      },
      designer: [],
      reset: 1,
    }
  dispatch_designer_settings_from_tx(
    Some(fixture_old_datum_data()),
    reset_redeemer,
    transaction.placeholder,
  )
}

test dispatch_designer_settings_from_tx_rejects_non_personalize_redeemer() {
  // persdsg only validates the Personalize redeemer; everything else fails.
  !dispatch_designer_settings_from_tx(
    Some(fixture_old_datum_data()),
    types.ReturnToSender,
    transaction.placeholder,
  )
}

test persdsg_observed_for_personalize_rejects_nonzero_withdrawal() {
  let own_ref = fixture_own_ref()
  let redeemer = fixture_personalize_redeemer()
  let observer_data = fixture_persdsg_observer_redeemer_data(own_ref, redeemer)
  // Withdrawal is non-zero — observer pattern requires Withdraw 0.
  let tx =
    fixture_tx_with_persdsg_observation(
      own_ref,
      redeemer,
      1,
      fixture_persdsg_credential(),
      observer_data,
    )
  !persdsg_observed_for_personalize(tx, own_ref, redeemer)
}

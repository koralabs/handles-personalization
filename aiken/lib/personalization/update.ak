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
fn parse_subhandle_settings_from_list(sh_data: Data) -> types.SubHandleSettings {
  expect [
    public_minting_enabled_data,
    pz_enabled_data,
    tier_pricing_data,
    default_styles_data,
    save_original_address_data,
  ]: List<Data> = sh_data
  expect public_minting_enabled: Int = public_minting_enabled_data
  expect pz_enabled: Int = pz_enabled_data
  expect tier_pricing: types.IntMatrix = tier_pricing_data
  expect save_original_address: Int = save_original_address_data
  types.SubHandleSettings {
    public_minting_enabled,
    pz_enabled,
    tier_pricing,
    default_styles: default_styles_data,
    save_original_address,
  }
}

fn parse_owner_settings_from_list(owner_data: Data) -> types.OwnerSettings {
  expect [
    nft_data,
    virtual_data,
    buy_down_price_data,
    buy_down_paid_data,
    buy_down_percent_data,
    agreed_terms_data,
    migrate_sig_required_data,
    payment_address_data,
  ]: List<Data> = owner_data
  let nft = parse_subhandle_settings_from_list(nft_data)
  let virtual = parse_subhandle_settings_from_list(virtual_data)
  expect buy_down_price: Int = buy_down_price_data
  expect buy_down_paid: Int = buy_down_paid_data
  expect buy_down_percent: Int = buy_down_percent_data
  expect migrate_sig_required: Int = migrate_sig_required_data
  expect payment_address: ByteArray = payment_address_data
  types.OwnerSettings {
    nft,
    virtual,
    buy_down_price,
    buy_down_paid,
    buy_down_percent,
    agreed_terms: agreed_terms_data,
    migrate_sig_required,
    payment_address,
  }
}

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

fn spend_redeemer_matches(
  redeemers: Pairs<transaction.ScriptPurpose, transaction.Redeemer>,
  own_ref: transaction.OutputReference,
  expected_redeemer: types.Redeemer,
) -> Bool {
  let expected_data: Data = expected_redeemer

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

pub fn observer_withdrawal_is_valid(
  tx: transaction.Transaction,
  own_ref: transaction.OutputReference,
  redeemer: types.Redeemer,
  valid_contracts: List<ByteArray>,
) -> Bool {
  let observer_redeemer_data: Data = types.Observe { own_ref, redeemer }

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

// Same logic as observer_withdrawal_is_valid, but takes the redeemer as raw
// PlutusData. The pers_proxy spend handler keeps its redeemer as `Data` to
// avoid Aiken's auto-cast on the Helios-shaped Personalize Constr (where
// inner fields like Handle / PzIndexes are List-encoded, not Constr-encoded).
// We construct the observer-redeemer Constr manually so byte-for-byte
// equality with the chain's withdrawal redeemer still holds.
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

pub fn dispatch_from_observer(
  observer_redeemer: types.ObserverRedeemer,
  tx: transaction.Transaction,
) -> Bool {
  trace @"dispatch_from_observer:enter"
  when observer_redeemer is {
    types.Observe { own_ref, redeemer } ->
      if !spend_redeemer_matches(tx.redeemers, own_ref, redeemer) {
        trace @"dispatch_from_observer:spend_redeemer_mismatch"
        False
      } else {
        trace @"dispatch_from_observer:spend_redeemer_match"
        when transaction.find_input(tx.inputs, own_ref) is {
          Some(input) -> {
            trace @"dispatch_from_observer:input_found"
            dispatch_from_tx(output_data(input.output, tx), redeemer, own_ref, tx)
          }
          None -> {
            trace @"dispatch_from_observer:input_not_found"
            False
          }
        }
      }
  }
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

fn outputs_have_owner_token(
  outputs: List<transaction.Output>,
  handle: ByteArray,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      output_has_handle_asset(
        output,
        constants.prefixed_asset_name(constants.lbl_222, handle),
      )
    },
  )
}

fn validity_start(tx: transaction.Transaction) -> Option<Int> {
  when tx.validity_range.lower_bound.bound_type is {
    interval.Finite(start) -> Some(start)
    interval.NegativeInfinity -> None
    interval.PositiveInfinity -> None
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

fn virtual_public_mint(extra: types.DataMap) -> Int {
  datum.int_or(
    parse_virtual_data(extra)
      |> option.and_then(
          fn(virtual) { datum.map_get(virtual, key_public_mint) },
        ),
    0,
  )
}

fn virtual_expiry(extra: types.DataMap) -> Int {
  datum.int_or(
    parse_virtual_data(extra)
      |> option.and_then(
          fn(virtual) { datum.map_get(virtual, key_expires_time) },
        ),
    0,
  )
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
      list.any(signatories, fn(sig) { sig == signer })
    address.Script(_) -> False
  }
}

fn signer_matches_stake_credential(
  signatories: List<ByteArray>,
  stake_credential: Option<address.StakeCredential>,
) -> Bool {
  when stake_credential is {
    Some(address.Inline(address.VerificationKey(signer))) ->
      list.any(signatories, fn(sig) { sig == signer })
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

fn personalize_inputs_from_context(
  handle: types.Handle,
  root_handle: ByteArray,
  indexes: types.PzIndexes,
  designer: types.DataMap,
  settings: types.PzSettings,
  own_ref: transaction.OutputReference,
  reset: Bool,
  context: PersonalizeTxContext,
  tx: transaction.Transaction,
) -> PersonalizeValidationInputs {
  let _ = root_handle
  let old_extra = context.old_extra
  let new_extra = context.new_extra
  let old_bg_asset =
    personalize_mpf_context.asset_from_extra(old_extra, key_bg_asset)
  let old_pfp_asset =
    personalize_mpf_context.asset_from_extra(old_extra, key_pfp_asset)
  let new_bg_asset =
    personalize_mpf_context.asset_from_extra(new_extra, key_bg_asset)
  let new_pfp_asset =
    personalize_mpf_context.asset_from_extra(new_extra, key_pfp_asset)
  let check_bg_asset =
    if reset {
      old_bg_asset
    } else {
      new_bg_asset
    }
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
      settings,
      tx,
    )
  let pfp_root =
    personalize_mpf_context.load_policy_index_root(
      indexes.pfp_approver,
      key_policy_ids_pfp,
      settings,
      tx,
    )
  let bg_status =
    personalize_mpf_context.approval_status_for_asset(
      bg_root,
      new_bg_asset,
      context.pz_asset_output.value,
      bg_proof,
    )
  let pfp_status =
    personalize_mpf_context.approval_status_for_asset(
      pfp_root,
      new_pfp_asset,
      context.pz_asset_output.value,
      pfp_proof,
    )
  let check_bg_status =
    personalize_mpf_context.approval_status_for_asset(
      bg_root,
      check_bg_asset,
      context.pz_asset_output.value,
      bg_proof,
    )
  let check_pfp_status =
    personalize_mpf_context.approval_status_for_asset(
      pfp_root,
      check_pfp_asset,
      context.pz_asset_output.value,
      pfp_proof,
    )
  let types.Cip68 { nft: old_nft, version: _, extra: _ } = context.old_datum
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
          context.contract_output,
          settings.valid_contracts,
          current_hash,
        )
      None -> False
    }

  // owner_handle_present: pz_asset_output must hold the LBL_222 owner token.
  // Helios: `pz_asset_output.value.contains(Value::new(LBL_222 + name, 1))`
  let owner_handle_present =
    assets.quantity_of(
      context.pz_asset_output.value,
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
  let parsed_last_update_address =
    when datum.map_get(new_extra, key_last_update_address) is {
      Some(addr_data) -> {
        expect addr_bytes: ByteArray = addr_data
        utils.address_from_shelley_bytes(addr_bytes)
      }
      None -> None
    }
  // Helios:
  //   HANDLE / NFT_SUBHANDLE -> address = pz_asset_output.address
  //   VIRTUAL_SUBHANDLE      -> address = new_ada_address
  let expected_owner_address =
    when handle.handle_type is {
      types.HandleTypeVirtualSubhandle -> parse_resolved_address(new_extra)
      _ -> Some(context.pz_asset_output.address)
    }
  let last_update_address_matches_owner =
    when (parsed_last_update_address, expected_owner_address) is {
      (Some(last_addr), Some(expected_addr)) -> last_addr == expected_addr
      _ -> False
    }

  // immutables_unchanged: per Helios immutables_are_unchanged.
  //   - extra.standard_image, extra.standard_image_hash, extra.original_address
  //     must equal between old and new
  //   - every old_nft.* (except 'image' and 'mediaType') must equal new_nft.*
  //   - new_extra.agreed_terms must equal "https://handle.me/$/tou"
  let types.Cip68 { nft: new_nft, version: _, extra: _ } = context.new_datum
  let standard_image_unchanged =
    datum.map_get(old_extra, key_standard_image) == datum.map_get(new_extra, key_standard_image)
  let standard_image_hash_unchanged =
    datum.map_get(old_extra, key_standard_image_hash) == datum.map_get(new_extra, key_standard_image_hash)
  let original_address_unchanged =
    datum.map_get(old_extra, key_original_address) == datum.map_get(new_extra, key_original_address)
  let immutable_nft_fields_unchanged =
    list.all(old_nft, fn(pair) {
      let key = pair.1st
      if key == key_image || key == "mediaType" {
        True
      } else {
        datum.map_get(new_nft, key) == Some(pair.2nd)
      }
    })
  let agreed_terms_is_set =
    when datum.map_get(new_extra, key_agreed_terms) is {
      Some(terms_data) -> {
        expect terms: ByteArray = terms_data
        terms == "https://handle.me/$/tou"
      }
      None -> False
    }
  let immutables_unchanged =
    personalize_base.immutables_are_unchanged(
      standard_image_unchanged,
      standard_image_hash_unchanged,
      original_address_unchanged,
      immutable_nft_fields_unchanged,
      agreed_terms_is_set,
    )

  // sub_pz_enabled / new_pz_enabled — read from old/new extra.
  let sub_pz_enabled =
    datum.int_or(datum.map_get(old_extra, key_pz_enabled), 0) != 0
  let new_pz_enabled =
    datum.int_or(datum.map_get(new_extra, key_pz_enabled), 0) != 0

  // root_pz_enabled + payment_address from owner_settings ref input.
  // For HANDLE type, Helios returns (True, ""). For NFT/VIRTUAL subhandle,
  // looks up OwnerSettings.{nft|virtual}.pz_enabled from indexes.owner_settings.
  let (root_pz_enabled, root_payment_address) =
    when handle.handle_type is {
      types.HandleTypeHandle -> (True, #"")
      _ ->
        when reference_output_at(tx.reference_inputs, indexes.owner_settings) is {
          Some(owner_output) ->
            when output_data(owner_output, tx) is {
              Some(owner_data) -> {
                let owner_settings = parse_owner_settings_from_list(owner_data)
                let enabled =
                  when handle.handle_type is {
                    types.HandleTypeNftSubhandle ->
                      owner_settings.nft.pz_enabled == 1
                    types.HandleTypeVirtualSubhandle ->
                      owner_settings.virtual.pz_enabled == 1
                    _ -> True
                  }
                (enabled, owner_settings.payment_address)
              }
              None -> (False, #"")
            }
          None -> (False, #"")
        }
    }
  // root_payment_address is used by fees_paid (root-fee output destination).
  let _ = root_payment_address

  // validated_by_* / expected_nsfw / bg/pfp image fields for policy_datum_is_valid.
  let validated_by_data_opt = datum.map_get(new_extra, "validated_by")
  let validated_by_present = validated_by_data_opt != None
  let validated_by_signed =
    when validated_by_data_opt is {
      Some(vb_data) -> {
        expect vb_hash: ByteArray = vb_data
        list.any(tx.extra_signatories, fn(s) { s == vb_hash })
      }
      None -> False
    }
  let expected_nsfw = datum.int_or(datum.map_get(new_extra, key_nsfw), 0)
  let bg_image_set = datum.map_get(new_extra, key_bg_image) != None
  let pfp_image_set = datum.map_get(new_extra, key_pfp_image) != None

  // bg/pfp_image_matches_datum: when bg_asset_set, look up bg_datum CIP-68 at
  // indexes.bg_datum ref input, compare its nft.image field to new_extra.bg_image.
  // For empty asset, vacuously True.
  let image_matches_datum = fn(asset_present: Bool, asset_class: datum.AssetClass, datum_index: Int, image_key: ByteArray) -> Bool {
    if !asset_present {
      True
    } else {
      let _ = asset_class
      when reference_output_at(tx.reference_inputs, datum_index) is {
        Some(asset_output) ->
          when output_data(asset_output, tx) is {
            Some(asset_datum_data) -> {
              expect asset_datum: types.PersonalizationDatum = asset_datum_data
              let types.Cip68 { nft: asset_nft, version: _, extra: _ } = asset_datum
              when (datum.map_get(asset_nft, key_image), datum.map_get(new_extra, image_key)) is {
                (Some(datum_image), Some(extra_image)) -> datum_image == extra_image
                _ -> False
              }
            }
            None -> False
          }
        None -> False
      }
    }
  }
  let bg_image_matches_datum =
    image_matches_datum(new_bg_asset != datum.empty_asset, new_bg_asset, indexes.bg_datum, key_bg_image)
  let pfp_image_matches_datum =
    image_matches_datum(new_pfp_asset != datum.empty_asset, new_pfp_asset, indexes.pfp_datum, key_pfp_image)

  // is_reset_shape: new datum looks like a reset state (no images, no assets,
  // no designer, trial/nsfw cleared). Helios:
  //   new_image == new_standard
  //   && new_img_hash == new_stand_hash
  //   && new_pfp_asset_opt == EMPTY_DATA
  //   && new_bg_asset_opt == EMPTY_DATA
  //   && new_pfp == None && new_bg == None
  //   && !designed
  //   && new_trial == 0 && new_nsfw == 0
  let designed = datum.map_get(new_extra, key_designer) != None
  let is_reset_shape = and {
      datum.map_get(new_nft, key_image) == datum.map_get(new_extra, key_standard_image),
      datum.map_get(new_extra, key_image_hash) == datum.map_get(new_extra, key_standard_image_hash),
      new_bg_asset == datum.empty_asset,
      new_pfp_asset == datum.empty_asset,
      datum.map_get(new_extra, key_bg_image) == None,
      datum.map_get(new_extra, key_pfp_image) == None,
      !designed,
      datum.int_or(datum.map_get(new_extra, key_trial), 0) == 0,
      datum.int_or(datum.map_get(new_extra, key_nsfw), 0) == 0,
    }

  // signed_by_owner / signed_by_provider — used by reset auth + reset privacy.
  // signed_by_owner: tx signed by the owner of the LBL_222 owner token's
  // payment address. We don't have the address directly here; we use the
  // pz_asset_output.address payment cred (Helios uses `address.credential`).
  let signed_by_owner =
    when context.pz_asset_output.address.payment_credential is {
      address.VerificationKey(hash) ->
        list.any(tx.extra_signatories, fn(s) { s == hash })
      _ -> False
    }
  let signed_by_provider =
    list.any(tx.extra_signatories, fn(signer) {
      list.any(settings.pz_providers, fn(provider) { signer == provider.2nd })
    })

  // reset_privacy_inputs — for the reset path. Helios checks (line 686-696):
  //   if last_update_address changed (holder changed), socials and
  //   resolved_addresses must be cleared. Otherwise either provider or
  //   owner must sign, OR both socials and resolved_addresses unchanged.
  let old_last_update_address_data = datum.map_get(old_extra, key_last_update_address)
  let new_last_update_address_data = datum.map_get(new_extra, key_last_update_address)
  let holder_changed =
    when (old_last_update_address_data, new_last_update_address_data) is {
      (Some(old_addr_data), Some(new_addr_data)) -> {
        expect old_bytes: ByteArray = old_addr_data
        expect new_bytes: ByteArray = new_addr_data
        when (utils.address_from_shelley_bytes(old_bytes), utils.address_from_shelley_bytes(new_bytes)) is {
          (Some(old_a), Some(new_a)) -> !utils.holder_addresses_match(old_a, new_a)
          _ -> True
        }
      }
      _ -> True
    }
  let socials_cleared = datum.map_get(new_extra, key_socials) == None
  let new_resolved_addresses_data = datum.map_get(new_extra, key_resolved_addresses)
  let resolved_addresses_cleared = new_resolved_addresses_data == None
  let socials_unchanged =
    datum.map_get(old_extra, key_socials) == datum.map_get(new_extra, key_socials)
  let resolved_addresses_unchanged =
    datum.map_get(old_extra, key_resolved_addresses) == new_resolved_addresses_data
  let reset_privacy_inputs =
    personalize_base.ResetPrivacyInputs {
      holder_changed,
      signed_by_provider,
      signed_by_owner,
      socials_cleared,
      resolved_addresses_cleared,
      socials_unchanged,
      resolved_addresses_unchanged,
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
  let parse_resolved_ada_address = fn(extra: types.DataMap) -> Option<address.Address> {
    when datum.map_get(extra, key_resolved_addresses) is {
      Some(resolved_data) -> {
        let resolved_map = datum.get_extra(resolved_data)
        when datum.map_get(resolved_map, key_ada) is {
          Some(addr_data) -> {
            expect addr_bytes: ByteArray = addr_data
            utils.address_from_shelley_bytes(addr_bytes)
          }
          None -> None
        }
      }
      None -> None
    }
  }
  let old_resolved_ada = parse_resolved_ada_address(old_extra)
  let new_resolved_ada = parse_resolved_ada_address(new_extra)
  let virtual_holder_signed =
    when old_resolved_ada is {
      Some(old_addr) ->
        when old_addr.payment_credential is {
          address.VerificationKey(hash) ->
            list.any(tx.extra_signatories, fn(s) { s == hash })
          _ -> False
        }
      None -> False
    }
  let virtual_resolved_ada_unchanged =
    when (old_resolved_ada, new_resolved_ada) is {
      (Some(old_addr), Some(new_addr)) -> old_addr == new_addr
      (None, None) -> True
      _ -> False
    }
  let virtual_payload_unchanged =
    datum.map_get(old_extra, key_virtual) == datum.map_get(new_extra, key_virtual)

  let unchanged_when_reset_denied = and {
      datum.map_get(old_nft, key_image) == datum.map_get(new_nft, key_image),
      datum.map_get(old_extra, key_image_hash) == datum.map_get(new_extra, key_image_hash),
      datum.map_get(old_extra, key_pfp_asset) == datum.map_get(new_extra, key_pfp_asset),
      datum.map_get(old_extra, key_bg_asset) == datum.map_get(new_extra, key_bg_asset),
      datum.map_get(old_extra, key_pfp_image) == datum.map_get(new_extra, key_pfp_image),
      datum.map_get(old_extra, key_bg_image) == datum.map_get(new_extra, key_bg_image),
      datum.map_get(old_extra, key_designer) == datum.map_get(new_extra, key_designer),
      datum.map_get(old_extra, key_trial) == datum.map_get(new_extra, key_trial),
      datum.map_get(old_extra, key_nsfw) == datum.map_get(new_extra, key_nsfw),
    }

  // fees_paid — translates Helios fees_are_paid. For non-reset designer
  // changes, the personalization tx must pay treasury + provider fees, plus
  // (for subhandles) a root-share to the root handle's payment address.
  // Within the grace_period after last_edited_time, all fees are waived.
  let last_edited_time =
    datum.int_or(datum.map_get(old_extra, key_last_edited_time), 0)
  let within_grace_period =
    last_edited_time != 0 && when validity_start(tx) is {
      Some(start) -> start < last_edited_time + settings.grace_period
      None -> False
    }
  let is_subhandle = handle.handle_type != types.HandleTypeHandle
  let subhandle_shared_fee =
    personalize_base.shared_subhandle_fee(settings.pz_min_fee, settings.subhandle_share_percent)
  let provider_amount =
    if is_subhandle {
      settings.pz_min_fee - subhandle_shared_fee
    } else {
      settings.pz_min_fee
    }

  let output_inline_datum_matches_handle = fn(out: transaction.Output) -> Bool {
    when datum.from_transaction_datum(out.datum) is {
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
    list.any(tx.outputs, fn(output) {
      let cred_match =
        when output.address.payment_credential is {
          address.Script(hash) -> hash == settings.treasury_cred
          _ -> False
        }
      cred_match && output_inline_datum_matches_handle(output) && assets.lovelace_of(output.value) >= settings.treasury_fee
    })

  // provider_fee_paid: output at indexes.provider_fee whose payment cred is
  // one of the registered providers and inline datum is the handle.
  let provider_fee_paid =
    when output_at(tx.outputs, indexes.provider_fee) is {
      Some(prov_output) -> {
        let payment_cred_hash =
          when prov_output.address.payment_credential is {
            address.VerificationKey(hash) -> Some(hash)
            address.Script(hash) -> Some(hash)
          }
        let cred_in_providers =
          when payment_cred_hash is {
            Some(hash) ->
              list.any(settings.pz_providers, fn(provider) { hash == provider.2nd })
            None -> False
          }
        cred_in_providers && output_inline_datum_matches_handle(prov_output) && assets.lovelace_of(prov_output.value) >= provider_amount
      }
      None -> False
    }

  // root_fee_paid: only for subhandles. Output sent to root payment_address
  // (resolved bech32 bytes from OwnerSettings) with handle datum and at
  // least subhandle_shared_fee lovelace.
  let root_fee_paid =
    !is_subhandle || when utils.address_from_shelley_bytes(root_payment_address) is {
      Some(root_addr) ->
        list.any(tx.outputs, fn(output) {
          output.address == root_addr && output_inline_datum_matches_handle(output) && assets.lovelace_of(output.value) >= subhandle_shared_fee
        })
      None -> False
    }
  let fees_paid =
    personalize_base.fees_are_paid(
      personalize_base.FeeValidationInputs {
        within_grace_period,
        treasury_fee_paid,
        provider_fee_paid,
        is_subhandle,
        root_fee_paid,
      },
    )

  PersonalizeValidationInputs {
    handle_type: handle.handle_type,
    reset,
    datum_name_matches_redeemer,
    output_has_expected_handle_token: personalize_base.output_has_expected_handle_token(
      context.contract_output.value,
      handle.handle_type,
      handle.name,
    ),
    last_update_address_matches_owner,
    owner_handle_present,
    resolved_ada_is_empty,
    sub_pz_enabled,
    root_pz_enabled,
    new_pz_enabled,
    virtual_holder_signed,
    virtual_resolved_ada_unchanged,
    virtual_payload_unchanged,
    contract_output_is_valid,
    immutables_unchanged,
    bg_status,
    pfp_status,
    check_bg_status,
    check_pfp_status,
    policy_datum_inputs: personalize_policy_approval.PolicyDatumValidationInputs {
      validated_by_present: validated_by_present,
      validated_by_signed: validated_by_signed,
      expected_nsfw: expected_nsfw,
      bg_asset_set: new_bg_asset != datum.empty_asset,
      pfp_asset_set: new_pfp_asset != datum.empty_asset,
      bg_image_set: bg_image_set,
      pfp_image_set: pfp_image_set,
      bg_image_matches_datum: bg_image_matches_datum,
      pfp_image_matches_datum: pfp_image_matches_datum,
    },
    designed,
    designer_changed: datum.map_get(new_extra, key_designer) != datum.map_get(
      old_extra,
      key_designer,
    ),
    // TODO: required_asset_valid — implement Helios check_required_assets:
    //   When bg_datum has defaults (bg_datum.extra.{required_signature,
    //   require_asset_collections, require_asset_attributes, require_asset_displayed}),
    //   verify (a) any required signature is in tx.extra_signatories, (b) every
    //   required asset collection has a token in pz_asset_output whose name starts
    //   with the collection prefix, (c) for LBL_222/444 tokens, the asset's CIP-68
    //   reference datum at indexes.required_asset has matching attributes, (d) if
    //   require_asset_displayed=1, the matched asset is the pfp or the personalized
    //   handle itself. Currently True when no bg_datum (bg stripped or absent), so
    //   scope-03 with bg stripped passes this check trivially.
    required_asset_valid: new_bg_asset == datum.empty_asset,
    fees_paid,
    // TODO: designer_settings_valid — implement Helios designer_settings_are_valid:
    //   (a) decode new_extra.designer as IPFS multihash bytes, strip 4-byte CIDv1
    //   prefix, compare to sha256(serialize(redeemer.designer)); (b) for each
    //   key in bg_datum.extra defaults, validate the matching designer property:
    //   simple_props (bg_border_colors, bg_colors, etc.) must be a value in the
    //   defaults array (when force_creator_settings=1); simp_excl_props must
    //   equal the default exactly; qr_props are handled separately. Currently
    //   True; needs full per-property logic.
    designer_settings_valid: True,
    is_reset_shape,
    reset_privacy_inputs,
    signed_by_provider,
    signed_by_owner,
    unchanged_when_reset_denied,
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
  if !inputs.datum_name_matches_redeemer {
    trace @"personalize_is_valid:fail:datum_name_matches_redeemer"
    False
  } else if !inputs.output_has_expected_handle_token {
    trace @"personalize_is_valid:fail:output_has_expected_handle_token"
    False
  } else if !inputs.last_update_address_matches_owner {
    trace @"personalize_is_valid:fail:last_update_address_matches_owner"
    False
  } else if !personalize_base.subhandle_personalization_is_allowed(
    inputs.handle_type,
    inputs.reset,
    inputs.sub_pz_enabled,
    inputs.root_pz_enabled,
    inputs.new_pz_enabled,
  ) {
    trace @"personalize_is_valid:fail:subhandle_personalization_is_allowed"
    False
  } else if inputs.handle_type != types.HandleTypeVirtualSubhandle && !(inputs.reset || inputs.owner_handle_present) {
    trace @"personalize_is_valid:fail:owner_handle_present"
    False
  } else if !personalize_base.resolved_ada_is_allowed(inputs.handle_type) && !inputs.resolved_ada_is_empty {
    trace @"personalize_is_valid:fail:resolved_ada_is_allowed"
    False
  } else if !virtual_personalization_rules_are_valid(inputs) {
    trace @"personalize_is_valid:fail:virtual_personalization_rules"
    False
  } else if !inputs.contract_output_is_valid {
    trace @"personalize_is_valid:fail:contract_output_is_valid"
    False
  } else if !inputs.immutables_unchanged {
    trace @"personalize_is_valid:fail:immutables_unchanged"
    False
  } else if !personalize_policy_approval.policy_datum_is_valid(
    inputs.bg_status,
    inputs.pfp_status,
    inputs.policy_datum_inputs,
  ) {
    trace @"personalize_is_valid:fail:policy_datum_is_valid"
    False
  } else if !inputs.reset {
    let ok = personalize_base.non_reset_authorization_is_valid(
      inputs.designed,
      inputs.designer_changed,
      inputs.required_asset_valid,
      inputs.fees_paid,
      inputs.designer_settings_valid,
      inputs.is_reset_shape,
    )
    if !ok {
      trace @"personalize_is_valid:fail:non_reset_authorization"
      False
    } else {
      True
    }
  } else {
    let ok = personalize_base.reset_privacy_is_valid(inputs.reset_privacy_inputs) && personalize_base.reset_authorization_is_valid(
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
    if !ok {
      trace @"personalize_is_valid:fail:reset_authorization"
      False
    } else {
      True
    }
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

fn default_update_inputs(
  handle_type: types.HandleType,
  protocol_settings_present: Bool,
  root_settings_present: Bool,
  pz_payload_unchanged: Bool,
  nft_unchanged: Bool,
  admin_signed: Bool,
) -> UpdateValidationInputs {
  UpdateValidationInputs {
    handle_type,
    protocol_settings_present,
    root_settings_present,
    pz_payload_unchanged,
    nft_unchanged,
    public_mint: False,
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
    admin_signed,
    new_public_mint_is_private: False,
    root_virtual_mint_enabled: False,
  }
}

fn update_inputs_from_tx(
  old_nft: types.DataMap,
  old_extra: types.DataMap,
  handle: types.Handle,
  root_handle: ByteArray,
  indexes: types.VirtIndexes,
  admin_signed: Bool,
  tx: transaction.Transaction,
) -> Option<UpdateValidationInputs> {
  let contract_output_opt = output_at(tx.outputs, indexes.contract_output)
  let root_output_opt = output_at(tx.outputs, indexes.root_handle)
  let admin_settings_output_opt =
    reference_output_at(tx.reference_inputs, indexes.admin_settings)
  let root_settings_output_opt =
    reference_output_at(tx.reference_inputs, indexes.root_settings)

  when contract_output_opt is {
    Some(contract_output) ->
      when output_data(contract_output, tx) is {
        Some(new_datum_data) -> {
          expect new_datum: types.PersonalizationDatum = new_datum_data
          let types.Cip68 { nft: new_nft, version: _, extra: new_extra_data } =
            new_datum
          let new_extra = datum.get_extra(new_extra_data)
          let protocol_settings_present =
            when admin_settings_output_opt is {
              Some(admin_settings_output) ->
                output_has_handle_asset(
                  admin_settings_output,
                  constants.prefixed_asset_name(
                    constants.lbl_222,
                    "sh_settings",
                  ),
                )
              None -> False
            }
          let root_settings_present =
            when root_settings_output_opt is {
              Some(root_settings_output) ->
                output_has_handle_asset(
                  root_settings_output,
                  constants.prefixed_asset_name(constants.lbl_001, root_handle),
                )
              None -> False
            }
          let pz_payload_unchanged =
            pz_payload_without_virtual_and_resolved(old_extra) == pz_payload_without_virtual_and_resolved(
              new_extra,
            )
          let nft_unchanged = old_nft == new_nft

          if !protocol_settings_present || !root_settings_present || !pz_payload_unchanged || !nft_unchanged {
            Some(
              default_update_inputs(
                handle.handle_type,
                protocol_settings_present,
                root_settings_present,
                pz_payload_unchanged,
                nft_unchanged,
                admin_signed,
              ),
            )
          } else {
            when parse_virtual_data(old_extra) is {
              Some(old_virtual) ->
                when parse_virtual_data(new_extra) is {
                  Some(new_virtual) ->
                    when parse_resolved_address(old_extra) is {
                      Some(old_address) ->
                        when parse_resolved_address(new_extra) is {
                          Some(new_address) ->
                            when admin_settings_output_opt is {
                              Some(admin_settings_output) ->
                                when root_settings_output_opt is {
                                  Some(root_settings_output) ->
                                    when
                                      output_data(admin_settings_output, tx)
                                    is {
                                      Some(admin_settings_data) -> {
                                        expect main_settings: types.MainSubHandleSettings =
                                          admin_settings_data

                                        when
                                          output_data(root_settings_output, tx)
                                        is {
                                          Some(root_settings_data) -> {
                                            expect root_settings: types.OwnerSettings =
                                              root_settings_data

                                            let old_expiry =
                                              datum.int_or(
                                                datum.map_get(
                                                  old_virtual,
                                                  key_expires_time,
                                                ),
                                                0,
                                              )
                                            let new_expiry =
                                              datum.int_or(
                                                datum.map_get(
                                                  new_virtual,
                                                  key_expires_time,
                                                ),
                                                0,
                                              )
                                            let valid_from = validity_start(tx)
                                            let expired =
                                              when valid_from is {
                                                Some(start) ->
                                                  start > old_expiry
                                                None -> False
                                              }
                                            let extended =
                                              when valid_from is {
                                                Some(start) ->
                                                  old_expiry + main_settings.expiry_duration == new_expiry && start > old_expiry - main_settings.renewal_window
                                                None -> False
                                              }
                                            let root_signed =
                                              when root_output_opt is {
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
                                            let assignee_signed_pay =
                                              signer_matches_payment_credential(
                                                tx.extra_signatories,
                                                old_address.payment_credential,
                                              )
                                            let assignee_signed_stake =
                                              signer_matches_stake_credential(
                                                tx.extra_signatories,
                                                old_address.stake_credential,
                                              )
                                            let good_main_payment =
                                              if extended {
                                                when
                                                  utils.address_from_shelley_bytes(
                                                    main_settings.payment_address,
                                                  )
                                                is {
                                                  Some(main_payment_address) ->
                                                    value_paid_to_with_handle_datum(
                                                      tx,
                                                      main_payment_address,
                                                      handle.name,
                                                      main_settings.virtual_price,
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
                                                    bytearray.length(
                                                      handle.name,
                                                    ),
                                                    root_settings.virtual.tier_pricing,
                                                  ) - main_settings.virtual_price

                                                when
                                                  utils.address_from_shelley_bytes(
                                                    root_settings.payment_address,
                                                  )
                                                is {
                                                  Some(root_payment_address) ->
                                                    value_paid_to_with_handle_datum(
                                                      tx,
                                                      root_payment_address,
                                                      handle.name,
                                                      root_price,
                                                    )
                                                  None -> False
                                                }
                                              } else {
                                                False
                                              }

                                            Some(
                                              UpdateValidationInputs {
                                                handle_type: handle.handle_type,
                                                protocol_settings_present,
                                                root_settings_present,
                                                pz_payload_unchanged,
                                                nft_unchanged,
                                                public_mint: datum.int_or(
                                                  datum.map_get(
                                                    old_virtual,
                                                    key_public_mint,
                                                  ),
                                                  0,
                                                ) != 0,
                                                root_signed,
                                                expired,
                                                address_changed: old_address != new_address,
                                                address_change_stake_approved: old_address.stake_credential == new_address.stake_credential,
                                                assignee_signed_pay,
                                                assignee_signed_stake,
                                                extended,
                                                expiry_unchanged: old_expiry == new_expiry,
                                                good_main_payment,
                                                good_root_payment,
                                                admin_signed,
                                                new_public_mint_is_private: datum.int_or(
                                                  datum.map_get(
                                                    new_virtual,
                                                    key_public_mint,
                                                  ),
                                                  0,
                                                ) == 0,
                                                root_virtual_mint_enabled: root_settings.virtual.public_minting_enabled != 0,
                                              },
                                            )
                                          }
                                          None -> None
                                        }
                                      }
                                      None -> None
                                    }
                                  None -> None
                                }
                              None -> None
                            }
                          None -> None
                        }
                      None -> None
                    }
                  None -> None
                }
              None -> None
            }
          }
        }
        None -> None
      }
    None -> None
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
                list.map(tx.outputs, fn(output) { output.value }),
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

              when
                update_inputs_from_tx(
                  old_nft,
                  old_extra,
                  handle,
                  root_handle,
                  indexes,
                  admin_signed,
                  tx,
                )
              is {
                Some(update_inputs) -> update_is_valid(update_inputs)
                None -> False
              }
            }

            types.Personalize { handle, root_handle, indexes, designer, reset } -> {
              trace @"dispatch_from_tx:personalize:enter"
              when
                personalize_context_from_tx(
                  old_datum_data,
                  indexes,
                  reset != 0,
                  tx,
                )
              is {
                Some(context) -> {
                  trace @"dispatch_from_tx:personalize:context_ok"
                  let validation_result = personalize_is_valid(
                    personalize_inputs_from_context(
                      handle,
                      root_handle,
                      indexes,
                      designer,
                      settings,
                      own_ref,
                      reset != 0,
                      context,
                      tx,
                    ),
                  )
                  if !validation_result {
                    trace @"dispatch_from_tx:personalize:validation_failed"
                    False
                  } else {
                    trace @"dispatch_from_tx:personalize:validation_ok"
                    True
                  }
                }
                None -> {
                  trace @"dispatch_from_tx:personalize:context_none"
                  False
                }
              }
            }
          }
        }
        None -> {
          trace @"dispatch_from_tx:no_settings"
          False
        }
      }
    None -> {
      trace @"dispatch_from_tx:no_datum"
      False
    }
  }
}

pub type DispatchInputs {
  redeemer: types.Redeemer,
  admin_signed: Bool,
  output_values: List<assets.Value>,
  migrate_datums_unchanged: Bool,
  migrate_output_has_expected_handle_token: Bool,
  migrate_output_contract_is_valid: Bool,
  migrate_owner_sig_required: Bool,
  migrate_owner_token_present: Bool,
  revoke_public_mint: Bool,
  revoke_root_signed: Bool,
  revoke_expired: Bool,
  revoke_minted_quantity: Int,
  personalize_inputs: Option<PersonalizeValidationInputs>,
  update_inputs: Option<UpdateValidationInputs>,
}

pub fn dispatch_redeemer(inputs: DispatchInputs) -> Bool {
  when inputs.redeemer is {
    types.ReturnToSender ->
      return_to_sender.return_to_sender_is_valid(
        inputs.output_values,
        inputs.admin_signed,
      )

    types.Migrate { .. } ->
      migrate.migrate_is_valid(
        inputs.migrate_datums_unchanged,
        inputs.migrate_output_has_expected_handle_token,
        inputs.migrate_output_contract_is_valid,
        migrate.migration_signers_are_valid(
          inputs.admin_signed,
          inputs.migrate_owner_sig_required,
          inputs.migrate_owner_token_present,
        ),
      )

    types.Revoke { handle, .. } ->
      revoke.revoke_is_valid(
        handle.handle_type,
        inputs.revoke_public_mint,
        inputs.revoke_root_signed,
        inputs.revoke_expired,
        inputs.revoke_minted_quantity,
      )

    types.Update { .. } ->
      when inputs.update_inputs is {
        Some(update_inputs) -> update_is_valid(update_inputs)
        None -> False
      }

    types.Personalize { .. } ->
      when inputs.personalize_inputs is {
        Some(personalize_inputs) -> personalize_is_valid(personalize_inputs)
        None -> False
      }
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

fn fixture_dispatch_inputs(redeemer: types.Redeemer) -> DispatchInputs {
  DispatchInputs {
    redeemer,
    admin_signed: True,
    output_values: [assets.zero],
    migrate_datums_unchanged: True,
    migrate_output_has_expected_handle_token: True,
    migrate_output_contract_is_valid: True,
    migrate_owner_sig_required: False,
    migrate_owner_token_present: False,
    revoke_public_mint: False,
    revoke_root_signed: True,
    revoke_expired: False,
    revoke_minted_quantity: -1,
    personalize_inputs: None,
    update_inputs: None,
  }
}

test dispatch_redeemer_return_to_sender_branch() {
  let forbidden =
    assets.from_asset(
      #"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a",
      #"000643b0616c696365",
      1,
    )

  and {
    dispatch_redeemer(fixture_dispatch_inputs(types.ReturnToSender)),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(types.ReturnToSender),
        output_values: [forbidden],
      },
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(types.ReturnToSender),
        admin_signed: False,
      },
    ),
  }
}

test dispatch_redeemer_migrate_branch_enforces_owner_requirement() {
  let handle =
    types.Handle { handle_type: types.HandleTypeHandle, name: "alice" }

  and {
    dispatch_redeemer(
      fixture_dispatch_inputs(types.Migrate { handle, output_index: 0 }),
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(types.Migrate { handle, output_index: 0 }),
        admin_signed: False,
      },
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(types.Migrate { handle, output_index: 0 }),
        migrate_owner_sig_required: True,
        migrate_owner_token_present: False,
      },
    ),
  }
}

test dispatch_redeemer_revoke_branch_uses_revoke_rules() {
  let handle =
    types.Handle {
      handle_type: types.HandleTypeVirtualSubhandle,
      name: "alice",
    }

  and {
    dispatch_redeemer(
      fixture_dispatch_inputs(
        types.Revoke { handle, root_handle: "root", owner_index: 0 },
      ),
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(
          types.Revoke { handle, root_handle: "root", owner_index: 0 },
        ),
        revoke_root_signed: False,
      },
    ),
  }
}

test dispatch_redeemer_update_branch_uses_update_rules() {
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

  and {
    dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(
          types.Update { handle, root_handle: "root", indexes },
        ),
        update_inputs: Some(fixture_update_inputs()),
      },
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(
          types.Update { handle, root_handle: "root", indexes },
        ),
        update_inputs: Some(
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
      },
    ),
    !dispatch_redeemer(
      fixture_dispatch_inputs(
        types.Update { handle, root_handle: "root", indexes },
      ),
    ),
  }
}

test dispatch_redeemer_personalize_branch_uses_personalize_rules() {
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

  and {
    dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(
          types.Personalize {
            handle,
            root_handle: "root",
            indexes,
            designer: [],
            reset: 0,
          },
        ),
        personalize_inputs: Some(
          fixture_personalize_inputs(types.HandleTypeHandle, False),
        ),
      },
    ),
    !dispatch_redeemer(
      DispatchInputs {
        ..fixture_dispatch_inputs(
          types.Personalize {
            handle,
            root_handle: "root",
            indexes,
            designer: [],
            reset: 0,
          },
        ),
        personalize_inputs: Some(
          PersonalizeValidationInputs {
            ..fixture_personalize_inputs(types.HandleTypeHandle, False),
            required_asset_valid: False,
          },
        ),
      },
    ),
    !dispatch_redeemer(
      fixture_dispatch_inputs(
        types.Personalize {
          handle,
          root_handle: "root",
          indexes,
          designer: [],
          reset: 0,
        },
      ),
    ),
  }
}

test personalize_is_valid_non_reset_cost_probe() {
  personalize_is_valid(
    fixture_personalize_inputs(types.HandleTypeHandle, False),
  )
}

test personalize_is_valid_reset_cost_probe() {
  personalize_is_valid(
    PersonalizeValidationInputs {
      ..fixture_personalize_inputs(types.HandleTypeHandle, True),
      designed: False,
      designer_changed: False,
      is_reset_shape: True,
      signed_by_provider: True,
    },
  )
}

test dispatch_redeemer_update_branch_cost_probe() {
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

  dispatch_redeemer(
    DispatchInputs {
      ..fixture_dispatch_inputs(
        types.Update { handle, root_handle: "root", indexes },
      ),
      update_inputs: Some(fixture_update_inputs()),
    },
  )
}

test dispatch_redeemer_personalize_branch_cost_probe() {
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

  dispatch_redeemer(
    DispatchInputs {
      ..fixture_dispatch_inputs(
        types.Personalize {
          handle,
          root_handle: "root",
          indexes,
          designer: [],
          reset: 0,
        },
      ),
      personalize_inputs: Some(
        fixture_personalize_inputs(types.HandleTypeHandle, False),
      ),
    },
  )
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

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

fn output_data(
  output: transaction.Output,
  tx: transaction.Transaction,
) -> Option<Data> {
  datum.get_datum_opt(output.datum, tx)
}

fn load_pz_settings(tx: transaction.Transaction) -> Option<types.PzSettings> {
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
          expect settings: types.PzSettings = settings_data
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
      |> option.and_then(fn(virtual) { datum.map_get(virtual, key_public_mint) }),
    0,
  )
}

fn virtual_expiry(extra: types.DataMap) -> Int {
  datum.int_or(
    parse_virtual_data(extra)
      |> option.and_then(fn(virtual) { datum.map_get(virtual, key_expires_time) }),
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
    contract_output: transaction.Output,
  }
}

fn personalize_context_from_tx(
  old_datum_data: Data,
  indexes: types.PzIndexes,
  tx: transaction.Transaction,
) -> Option<PersonalizeTxContext> {
  expect old_datum: types.PersonalizationDatum = old_datum_data

  when output_at(tx.outputs, indexes.contract_output) is {
    Some(contract_output) ->
      when output_data(contract_output, tx) is {
        Some(new_datum_data) -> {
          expect new_datum: types.PersonalizationDatum = new_datum_data
          Some(PersonalizeTxContext { old_datum, new_datum, contract_output })
        }
        None -> None
      }
    None -> None
  }
}

fn personalize_inputs_from_context(
  handle: types.Handle,
  reset: Bool,
  context: PersonalizeTxContext,
) -> PersonalizeValidationInputs {
  // DX-001 staged parser wiring: keep strict-deny defaults until D-002 fills
  // full tx-aware branch parity inputs.
  PersonalizeValidationInputs {
    handle_type: handle.handle_type,
    reset,
    datum_name_matches_redeemer: True,
    output_has_expected_handle_token: personalize_base.output_has_expected_handle_token(
      context.contract_output.value,
      handle.handle_type,
      handle.name,
    ),
    last_update_address_matches_owner: False,
    owner_handle_present: False,
    resolved_ada_is_empty: True,
    sub_pz_enabled: False,
    root_pz_enabled: False,
    new_pz_enabled: False,
    virtual_holder_signed: False,
    virtual_resolved_ada_unchanged: False,
    virtual_payload_unchanged: False,
    contract_output_is_valid: False,
    immutables_unchanged: False,
    bg_status: personalize_policy_approval.ApprovalNotRequired,
    pfp_status: personalize_policy_approval.ApprovalNotRequired,
    check_bg_status: personalize_policy_approval.ApprovalNotRequired,
    check_pfp_status: personalize_policy_approval.ApprovalNotRequired,
    policy_datum_inputs: personalize_policy_approval.PolicyDatumValidationInputs {
      validated_by_present: False,
      validated_by_signed: False,
      expected_nsfw: 0,
      expected_trial: 0,
      bg_asset_set: False,
      pfp_asset_set: False,
      bg_image_set: False,
      pfp_image_set: False,
      bg_image_matches_datum: True,
      pfp_image_matches_datum: True,
    },
    designed: False,
    designer_changed: False,
    required_asset_valid: False,
    fees_paid: False,
    designer_settings_valid: False,
    is_reset_shape: False,
    reset_privacy_inputs: personalize_base.ResetPrivacyInputs {
      holder_changed: False,
      signed_by_provider: False,
      signed_by_owner: False,
      socials_cleared: False,
      resolved_addresses_cleared: False,
      socials_unchanged: False,
      resolved_addresses_unchanged: False,
    },
    signed_by_provider: False,
    signed_by_owner: False,
    unchanged_when_reset_denied: False,
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
    False
  } else if !inputs.output_has_expected_handle_token {
    False
  } else if !inputs.last_update_address_matches_owner {
    False
  } else if !personalize_base.subhandle_personalization_is_allowed(
    inputs.handle_type,
    inputs.reset,
    inputs.sub_pz_enabled,
    inputs.root_pz_enabled,
    inputs.new_pz_enabled,
  ) {
    False
  } else if inputs.handle_type != types.HandleTypeVirtualSubhandle && !(inputs.reset || inputs.owner_handle_present) {
    False
  } else if !personalize_base.resolved_ada_is_allowed(inputs.handle_type) && !inputs.resolved_ada_is_empty {
    False
  } else if !virtual_personalization_rules_are_valid(inputs) {
    False
  } else if !inputs.contract_output_is_valid || !inputs.immutables_unchanged {
    False
  } else if !personalize_policy_approval.policy_datum_is_valid(
    inputs.bg_status,
    inputs.pfp_status,
    inputs.policy_datum_inputs,
  ) {
    False
  } else if !inputs.reset {
    personalize_base.non_reset_authorization_is_valid(
      inputs.designed,
      inputs.designer_changed,
      inputs.required_asset_valid,
      inputs.fees_paid,
      inputs.designer_settings_valid,
      inputs.is_reset_shape,
    )
  } else {
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
                datum.int_or(datum.map_get(old_extra, key_migrate_sig_required), 0) != 0

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

            types.Personalize { handle, indexes, reset, .. } ->
              when
                personalize_context_from_tx(old_datum_data, indexes, tx)
              is {
                Some(context) ->
                  personalize_is_valid(
                    personalize_inputs_from_context(
                      handle,
                      reset != 0,
                      context,
                    ),
                  )
                None -> False
              }
          }
        }
        None -> False
      }
    None -> False
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
      expected_trial: 0,
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
  let output =
    fixture_script_output(#"bbbb", assets.zero, transaction.NoDatum)

  when
    personalize_context_from_tx(
      fixture_old_datum_data(),
      indexes,
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

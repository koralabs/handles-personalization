use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction
use personalization/types

pub const bootstrap_admin_signer: ByteArray =
  #"4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1"

pub fn holder_addresses_match(
  address_1: address.Address,
  address_2: address.Address,
) -> Bool {
  when address_1.stake_credential is {
    None -> address_1.payment_credential == address_2.payment_credential
    Some(stake_1) ->
      when address_2.stake_credential is {
        None -> address_1.payment_credential == address_2.payment_credential
        Some(stake_2) -> stake_1 == stake_2
      }
  }
}

pub fn is_valid_contract(
  output: transaction.Output,
  valid_contracts: List<ByteArray>,
  current_validator_hash: ByteArray,
) -> Bool {
  list.any(valid_contracts, fn(hash) { hash == current_validator_hash }) && when
    output.address.payment_credential
  is {
    address.Script(output_validator_hash) ->
      list.any(valid_contracts, fn(hash) { hash == output_validator_hash })
    address.VerificationKey(_) -> False
  }
}

pub fn admin_has_signed_tx(
  admin_creds: List<ByteArray>,
  signatories: List<ByteArray>,
) -> Bool {
  !list.is_empty(signatories) && list.any(
    signatories,
    fn(signer) {
      signer == bootstrap_admin_signer || list.any(
        admin_creds,
        fn(admin) { signer == admin },
      )
    },
  )
}

pub fn get_virtual_price(length: Int, tiers: types.IntMatrix) -> Int {
  expect [first, ..rest] = tiers
  let selected =
    list.foldl(
      rest,
      first,
      fn(tier, selected) {
        expect [threshold, _, ..] = tier
        if length >= threshold {
          tier
        } else {
          selected
        }
      },
    )
  expect [_, price, ..] = selected

  price
}

pub fn address_from_shelley_bytes(bytes: ByteArray) -> Option<address.Address> {
  if bytearray.length(bytes) < 29 {
    None
  } else {
    let header = bytearray.at(bytes, 0)
    let address_type = header / 16
    let payment_hash = bytearray.slice(bytes, 1, 28)
    let payment_credential =
      if address_type == 0 || address_type == 2 || address_type == 4 || address_type == 6 {
        address.VerificationKey(payment_hash)
      } else if address_type == 1 || address_type == 3 || address_type == 5 || address_type == 7 {
        address.Script(payment_hash)
      } else {
        address.VerificationKey(payment_hash)
      }

    when stake_credential_from_payload(bytes, address_type) is {
      Some(stake_credential) ->
        Some(
          address.Address {
            payment_credential,
            stake_credential: Some(stake_credential),
          },
        )
      None ->
        if address_type == 6 || address_type == 7 {
          Some(address.Address { payment_credential, stake_credential: None })
        } else {
          None
        }
    }
  }
}

fn stake_credential_from_payload(
  bytes: ByteArray,
  address_type: Int,
) -> Option<address.StakeCredential> {
  if address_type == 0 || address_type == 1 || address_type == 2 || address_type == 3 {
    if bytearray.length(bytes) != 57 {
      None
    } else {
      let stake_hash = bytearray.drop(bytes, 29)
      let inline_credential =
        if address_type == 0 || address_type == 1 {
          address.VerificationKey(stake_hash)
        } else {
          address.Script(stake_hash)
        }

      Some(address.Inline(inline_credential))
    }
  } else if address_type == 4 || address_type == 5 {
    parse_pointer(bytes, 29)
  } else {
    None
  }
}

fn parse_pointer(
  bytes: ByteArray,
  start: Int,
) -> Option<address.StakeCredential> {
  when parse_var_uint(bytes, start, 0) is {
    Some((slot_number, next_1)) ->
      when parse_var_uint(bytes, next_1, 0) is {
        Some((transaction_index, next_2)) ->
          when parse_var_uint(bytes, next_2, 0) is {
            Some((certificate_index, next_3)) ->
              if next_3 == bytearray.length(bytes) {
                Some(
                  address.Pointer {
                    slot_number,
                    transaction_index,
                    certificate_index,
                  },
                )
              } else {
                None
              }
            None -> None
          }
        None -> None
      }
    None -> None
  }
}

fn parse_var_uint(bytes: ByteArray, index: Int, acc: Int) -> Option<(Int, Int)> {
  if index >= bytearray.length(bytes) {
    None
  } else {
    let byte = bytearray.at(bytes, index)
    let value = acc * 128 + byte % 128
    if byte >= 128 {
      parse_var_uint(bytes, index + 1, value)
    } else {
      Some((value, index + 1))
    }
  }
}

fn script_output(script_hash: ByteArray) -> transaction.Output {
  transaction.Output {
    address: address.from_script(script_hash),
    value: assets.zero,
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

test holder_addresses_match_uses_payment_when_stake_missing() {
  let payment_only = address.from_verification_key(#"01")
  let same_payment_with_stake =
    payment_only |> address.with_delegation_key(#"aa")
  let different_payment = address.from_verification_key(#"02")

  and {
    holder_addresses_match(payment_only, same_payment_with_stake),
    !holder_addresses_match(payment_only, different_payment),
  }
}

test holder_addresses_match_uses_stake_when_present_on_both() {
  let left =
    address.from_verification_key(#"01")
      |> address.with_delegation_key(#"aa")
  let same_stake_different_payment =
    address.from_verification_key(#"02")
      |> address.with_delegation_key(#"aa")
  let different_stake =
    address.from_verification_key(#"02")
      |> address.with_delegation_key(#"bb")

  and {
    holder_addresses_match(left, same_stake_different_payment),
    !holder_addresses_match(left, different_stake),
  }
}

test is_valid_contract_requires_current_and_output_contract_membership() {
  let current = #"aaaa"
  let output = #"bbbb"
  let valid = [current, output]

  and {
    is_valid_contract(script_output(output), valid, current),
    !is_valid_contract(script_output(output), [output], current),
    !is_valid_contract(script_output(#"cccc"), valid, current),
  }
}

test is_valid_contract_rejects_non_script_output_credential() {
  let output =
    transaction.Output {
      address: address.from_verification_key(#"01"),
      value: assets.zero,
      datum: transaction.NoDatum,
      reference_script: None,
    }

  !is_valid_contract(output, [#"aaaa"], #"aaaa")
}

test admin_has_signed_tx_checks_bootstrap_and_admin_lists() {
  and {
    admin_has_signed_tx([#"1111"], []) == False,
    admin_has_signed_tx([#"1111"], [#"1111"]),
    admin_has_signed_tx([], [bootstrap_admin_signer]),
    !admin_has_signed_tx([#"1111"], [#"2222"]),
  }
}

test get_virtual_price_picks_highest_matching_tier() {
  let tiers = [[1, 100], [5, 250], [10, 500]]

  and {
    get_virtual_price(1, tiers) == 100,
    get_virtual_price(8, tiers) == 250,
    get_virtual_price(14, tiers) == 500,
  }
}

test address_from_shelley_bytes_parses_enterprise_key() {
  let hash = #"12345678901234567890123456789012345678901234567890123456"
  let bytes = bytearray.concat(#"60", hash)

  address_from_shelley_bytes(bytes) == Some(
    address.Address {
      payment_credential: address.VerificationKey(hash),
      stake_credential: None,
    },
  )
}

test address_from_shelley_bytes_parses_base_key_key() {
  let payment = #"01010101010101010101010101010101010101010101010101010101"
  let stake = #"02020202020202020202020202020202020202020202020202020202"
  let bytes = bytearray.concat(#"00", bytearray.concat(payment, stake))

  address_from_shelley_bytes(bytes) == Some(
    address.Address {
      payment_credential: address.VerificationKey(payment),
      stake_credential: Some(address.Inline(address.VerificationKey(stake))),
    },
  )
}

test address_from_shelley_bytes_parses_pointer_payload() {
  let payment = #"01010101010101010101010101010101010101010101010101010101"
  let pointer = #"810180018002"
  let bytes = bytearray.concat(#"40", bytearray.concat(payment, pointer))

  address_from_shelley_bytes(bytes) == Some(
    address.Address {
      payment_credential: address.VerificationKey(payment),
      stake_credential: Some(
        address.Pointer {
          slot_number: 129,
          transaction_index: 1,
          certificate_index: 2,
        },
      ),
    },
  )
}

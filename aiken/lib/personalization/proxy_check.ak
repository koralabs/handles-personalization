// Proxy spend check — FROZEN MODULE
//
// Pinned persprx hash (production build, no verbose traces):
//   7cf105586f77934a524c9e78f8879a33460104f9578e9ac927f577e3
//
// `scripts/check-persprx-hash-stable.js` reads `aiken/plutus.json` and
// asserts the build's persprx.hash matches the pinned value above. Any
// edit to this module (or to the Aiken stdlib / cardano stdlib version
// pinned in `aiken/aiken.lock`) will change the build hash and trip the
// check. If the trip is intentional, update the pinned value here AND
// in the script AND publish an LBL_100 migration plan to all stakeholders.
//
// This module contains the entire body of `validators/persprx.ak`. Every
// byte of persprx's compiled UPLC is derived from this file plus the
// Aiken stdlib + the cardano stdlib types. Changing anything here
// changes persprx's blake2b-224 hash, which changes its scriptAddress,
// which strands every existing handle whose LBL_100 reference token is
// locked at the old proxy address.
//
// **DO NOT MODIFY this file** without first writing a chain-wide
// LBL_100 migration plan and getting explicit sign-off. Performance,
// readability, and feature work all belong elsewhere:
//
//   - Validator logic for the Personalize/Migrate/Update/etc. variants
//     lives in `update.ak` and is delegated to via the withdraw-observer
//     pattern (perspz / perslfc / persdsg). Those validators ARE
//     swappable — multisig adds a new observer hash to
//     `pz_settings.valid_contracts` and the old hash gets dropped.
//
//   - Designer-settings validation lives in `designer_settings.ak`,
//     reachable through persdsg only.
//
//   - The proxy itself only needs to answer one yes/no question:
//     "Did some authorized observer fire with a redeemer that committed
//     to this exact spend?". Adding any other responsibility to the
//     proxy defeats the proxy pattern.
//
// Stability guardrails this module deliberately uses:
//
//   1. No imports from any other personalization/* module. Constants
//      are duplicated inline (handle policy id, pz_settings asset name)
//      so that changes to constants.ak / datum.ak / update.ak / types.ak
//      cannot bubble in here.
//
//   2. The pz_settings datum is parsed with a `..` rest pattern so
//      future field additions to pz_settings (after `settings_cred`)
//      do not change persprx's UPLC. The fields persprx actually reads
//      — `valid_contracts` (idx 4) and `settings_cred` (idx 6) — are
//      load-bearing; a re-ordering of the leading fields WOULD break
//      the proxy and require a migration.
//
//   3. The observer-redeemer envelope is built directly with
//      `builtin.constr_data(0, [own_ref_data, redeemer])`, matching the
//      shape every observer constructs on the validation side. This is
//      the cross-contract protocol; changing it means simultaneously
//      re-deploying every observer AND migrating every handle.
//
//   4. Inline-datum-only. The proxy refuses to chase a datum hash. The
//      multisig writes pz_settings as inline datum; refusing the hash
//      path means we don't transit `transaction.find_datum`, removing
//      another future-evolution risk.

use aiken/builtin
use aiken/collection/list
use cardano/address
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

// Hard-coded copies of the two constants persprx needs. Defined here
// rather than imported from `constants.ak` so the proxy hash never
// changes if `constants.ak` is reorganized.

const handle_policy_id: ByteArray =
  #"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"

// "000de140" (LBL_222) ++ "pz_settings" — the LBL_222 user-token of
// the pz_settings handle.
const pz_handle_asset_name: ByteArray =
  #"000de140707a5f73657474696e6773"

// Resolve `pz_settings.valid_contracts` from the tx, defending against
// a forged settings UTxO by checking that the input's payment
// credential matches the `settings_cred` field of its own datum
// (multisig is the only writer that produces a UTxO satisfying both).
//
// Returns None when:
//   - no reference input carries the pz_settings LBL_222 user token
//   - the pz_settings input doesn't use an inline datum
//   - the input's payment credential isn't a script, or doesn't match
//     the `settings_cred` field
//   - the datum doesn't decode as a 7-or-more-element List<Data> with
//     the expected types at indices 4 and 6
fn load_valid_contracts(tx: Transaction) -> Option<List<ByteArray>> {
  when
    list.find(
      tx.reference_inputs,
      fn(input) {
        assets.quantity_of(
          input.output.value,
          handle_policy_id,
          pz_handle_asset_name,
        ) == 1
      },
    )
  is {
    None -> None
    Some(input) ->
      when input.output.datum is {
        InlineDatum(settings_data) -> {
          expect [_, _, _, _, vc_data, _, sc_data, ..]: List<Data> =
            settings_data
          expect settings_cred: ByteArray = sc_data
          when input.output.address.payment_credential is {
            address.Script(hash) ->
              if hash == settings_cred {
                expect valid_contracts: List<ByteArray> = vc_data
                Some(valid_contracts)
              } else {
                None
              }
            address.VerificationKey(_) -> None
          }
        }
        _ -> None
      }
  }
}

// Construct the observer-redeemer Constr `Constr 0 [own_ref, redeemer]`
// — the exact shape every withdraw-observer expects to find in the tx
// witness set. Built directly with `constr_data` to avoid auto-cast on
// the Helios-shaped Personalize redeemer (whose nested Handle and
// PzIndexes fields are List-encoded, not Constr-encoded).
fn observer_redeemer_envelope(
  own_ref: OutputReference,
  redeemer: Data,
) -> Data {
  let own_ref_data: Data = own_ref
  builtin.constr_data(0, [own_ref_data, redeemer])
}

// True when some Withdraw entry in the tx (a) has a script credential
// listed in `valid_contracts`, (b) carries a zero-ada withdrawal entry,
// and (c) presents the observer-redeemer envelope verbatim.
fn observer_fired(
  tx: Transaction,
  valid_contracts: List<ByteArray>,
  observer_redeemer: Data,
) -> Bool {
  list.any(
    tx.redeemers,
    fn(entry) {
      entry.2nd == observer_redeemer && when entry.1st is {
        transaction.Withdraw(credential) -> {
          let credential_authorized =
            when credential is {
              address.Script(hash) ->
                list.any(
                  valid_contracts,
                  fn(allowed) { allowed == hash },
                )
              address.VerificationKey(_) -> False
            }
          credential_authorized && list.any(
            tx.withdrawals,
            fn(w) { w.1st == credential && w.2nd == 0 },
          )
        }
        _ -> False
      }
    },
  )
}

// The single entry-point the persprx validator calls. Returns True iff
// the spend is authorized by an observer in pz_settings.valid_contracts.
pub fn proxy_spend_is_valid(
  redeemer: Data,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  when load_valid_contracts(tx) is {
    None -> False
    Some(valid_contracts) ->
      observer_fired(
        tx,
        valid_contracts,
        observer_redeemer_envelope(own_ref, redeemer),
      )
  }
}

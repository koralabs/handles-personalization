use cardano/transaction.{OutputReference, Transaction}
use personalization/types
use personalization/update

// Proxy-spend handler: we deliberately keep `redeemer` as raw `Data` instead
// of Aiken's auto-cast `types.Redeemer`, because the Helios-era BFF emits the
// nested handle / pz_indexes fields as Plutus `List` (struct serialization)
// rather than `Constr 0` (Aiken record serialization). The auto-cast lowers
// to `unConstrData` on those List values and fails the entire spend before
// reaching our logic. By taking `Data`, we forward the raw bytes to the
// observer-redeemer comparison without re-encoding, and the equality check
// happens at the Plutus-Data layer where shape doesn't matter.
validator persprx {
  spend(
    _datum_opt: Option<Data>,
    redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    when update.load_pz_settings(tx) is {
      Some(settings) ->
        update.observer_withdrawal_is_valid_data(
          tx,
          own_ref,
          redeemer,
          settings.valid_contracts,
        )
      None -> False
    }
  }

  else(_) {
    fail
  }
}

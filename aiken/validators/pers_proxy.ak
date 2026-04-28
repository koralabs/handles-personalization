use cardano/transaction.{OutputReference, Transaction}
use personalization/types
use personalization/update

validator personalization_proxy {
  spend(
    _datum_opt: Option<Data>,
    redeemer: types.Redeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    when update.load_pz_settings(tx) is {
      Some(settings) ->
        update.observer_withdrawal_is_valid(
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

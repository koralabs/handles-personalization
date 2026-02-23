use cardano/transaction.{OutputReference, Transaction}
use personalization/types
use personalization/update

validator personalization {
  spend(
    datum_opt: Option<Data>,
    redeemer: types.Redeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    update.dispatch_from_tx(datum_opt, redeemer, own_ref, tx)
  }

  else(_) {
    fail
  }
}

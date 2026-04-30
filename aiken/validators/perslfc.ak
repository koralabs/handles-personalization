use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use personalization/types
use personalization/update

// Per-variant split: this withdraw observer handles every Redeemer EXCEPT
// Personalize — i.e. Migrate, Revoke, Update, ReturnToSender. Personalize
// is served by `perspz`. See perspz.ak for the rationale.
validator perslfc {
  withdraw(
    observer_redeemer: types.ObserverRedeemer,
    _account: Credential,
    tx: Transaction,
  ) {
    update.validate_observer_other(observer_redeemer, tx)
  }

  else(_) {
    fail
  }
}

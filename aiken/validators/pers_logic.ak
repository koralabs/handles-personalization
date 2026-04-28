use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use personalization/types
use personalization/update

validator personalization_logic {
  withdraw(
    observer_redeemer: types.ObserverRedeemer,
    _account: Credential,
    tx: Transaction,
  ) {
    update.dispatch_from_observer(observer_redeemer, tx)
  }

  else(_) {
    fail
  }
}

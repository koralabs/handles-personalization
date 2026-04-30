use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use personalization/types
use personalization/update

// Per-variant split: this withdraw observer handles ONLY the Personalize
// redeemer. Migrate/Revoke/Update/ReturnToSender are served by the sibling
// `perslfc` validator. The persprx.observer_withdrawal_is_valid check
// accepts ANY Withdraw entry whose script credential is in
// pz_settings.valid_contracts, so the BFF picks which sibling to invoke
// based on the redeemer it builds.
//
// Splitting this way lets Aiken DCE branches each script doesn't serve,
// keeping each compiled validator under the Conway max_tx_size of 16384
// bytes — the original monolithic pers_logic was 20.1 KB.
validator perspz {
  withdraw(
    observer_redeemer: types.ObserverRedeemer,
    _account: Credential,
    tx: Transaction,
  ) {
    update.validate_observer_personalize(observer_redeemer, tx)
  }

  else(_) {
    fail
  }
}

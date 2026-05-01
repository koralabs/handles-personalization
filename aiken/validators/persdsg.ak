use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use personalization/types
use personalization/update

// Designer-settings observer: validates `designer_settings_are_valid` for the
// Personalize redeemer. perspz delegates this validation by including a
// `Withdraw 0` entry at this validator's reward address, then verifies via
// `persdsg_observed_for_personalize` that this validator fired with a
// matching observer-redeemer.
//
// For reset=True personalize txs, designer_settings is not checked
// (Helios semantics: reset wipes the personalization, so designer payload is
// irrelevant). persdsg short-circuits to True in that case, and perspz only
// requires persdsg's observation for non-reset txs.
//
// Splitting designer_settings out of perspz cuts ~2,500 bytes from perspz's
// validator binary; persdsg itself measures ~5,000 bytes (designer_settings
// + base58 + multihash + observer scaffold + the tx-context loaders that
// can't be DCE'd because they're shared with the perspz path).
validator persdsg {
  withdraw(
    observer_redeemer: types.ObserverRedeemer,
    _account: Credential,
    tx: Transaction,
  ) {
    update.validate_observer_designer_settings(observer_redeemer, tx)
  }

  else(_) {
    fail
  }
}

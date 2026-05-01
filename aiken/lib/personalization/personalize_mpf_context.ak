use aiken/collection/list
use cardano/address
use cardano/assets
use cardano/transaction
use personalization/constants
use personalization/datum
use personalization/personalize_policy_approval
use personalization/policy_index_mpf
use personalization/policy_index_types
use personalization/types
use personalization/utils

pub fn asset_from_extra(
  extra: types.DataMap,
  key: ByteArray,
) -> datum.AssetClass {
  when datum.map_get(extra, key) is {
    Some(asset_data) -> {
      expect asset_bytes: ByteArray = asset_data
      datum.parse_asset_bytes(asset_bytes)
    }
    None -> datum.empty_asset
  }
}

pub fn proof_from_designer(
  designer: types.DataMap,
  key: ByteArray,
) -> Option<policy_index_types.PolicyApprovalProof> {
  when datum.map_get(designer, key) is {
    Some(proof_data) -> {
      expect proof: policy_index_types.PolicyApprovalProof = proof_data
      Some(proof)
    }
    None -> None
  }
}

fn policy_index_root_token_present(
  value: assets.Value,
  suffix: ByteArray,
) -> Bool {
  assets.quantity_of(
    value,
    constants.handle_policy_id,
    constants.prefixed_asset_name(constants.lbl_222, suffix),
  ) == 1
}

fn credential_matches_provider_or_settings(
  credential: address.PaymentCredential,
  pz_providers: Pairs<ByteArray, ByteArray>,
  settings_cred: ByteArray,
) -> Bool {
  when credential is {
    address.VerificationKey(hash) ->
      list.any(pz_providers, fn(provider) { provider.2nd == hash })
    address.Script(hash) ->
      hash == settings_cred || list.any(
        pz_providers,
        fn(provider) { provider.2nd == hash },
      )
  }
}

pub fn load_policy_index_root(
  index: Int,
  suffix: ByteArray,
  pz_providers: Pairs<ByteArray, ByteArray>,
  settings_cred: ByteArray,
  tx: transaction.Transaction,
) -> Option<policy_index_types.PolicyIndexRoot> {
  when list.at(tx.reference_inputs, index) is {
    Some(input) ->
      if !policy_index_root_token_present(input.output.value, suffix) {
        None
      } else if !credential_matches_provider_or_settings(
        input.output.address.payment_credential,
        pz_providers,
        settings_cred,
      ) {
        None
      } else {
        when datum.get_datum_opt(input.output.datum, tx) is {
          Some(root_data) -> {
            expect root: policy_index_types.PolicyIndexRoot = root_data
            Some(root)
          }
          None -> None
        }
      }
    None -> None
  }
}

pub fn approval_status_for_asset(
  root: Option<policy_index_types.PolicyIndexRoot>,
  asset: datum.AssetClass,
  pz_asset_value: assets.Value,
  proof: Option<policy_index_types.PolicyApprovalProof>,
) -> personalize_policy_approval.AssetApprovalStatus {
  if asset == datum.empty_asset {
    personalize_policy_approval.ApprovalNotRequired
  } else {
    when root is {
      Some(root_value) ->
        if assets.quantity_of(pz_asset_value, asset.policy_id, asset.asset_name) != 1 {
          personalize_policy_approval.ApprovalRejected
        } else {
          when proof is {
            Some(p) ->
              when
                policy_index_mpf.verify_policy_approval(
                  root_value,
                  asset.policy_id,
                  asset.asset_name,
                  p,
                )
              is {
                Some(nsfw) -> personalize_policy_approval.Approved { nsfw }
                None -> personalize_policy_approval.ApprovalRejected
              }
            None -> personalize_policy_approval.ApprovalRejected
          }
        }
      None -> personalize_policy_approval.ApprovalRejected
    }
  }
}

const key_policy_ids_bg: ByteArray = "bg_policy_ids"

const key_policy_ids_pfp: ByteArray = "pfp_policy_ids"

// ----- tests -----

fn fixture_policy_id() -> ByteArray {
  #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
}

fn fixture_root() -> policy_index_types.PolicyIndexRoot {
  #"256e8792c4dd0c7ec077dd9501a7e0233bbbeb9cdf659795d5be1b4bdcd16bda"
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

fn fixture_reference_input_for_root(
  tx_id: ByteArray,
  output_index: Int,
  suffix: ByteArray,
  root: policy_index_types.PolicyIndexRoot,
) -> transaction.Input {
  let root_data: Data = root
  let value =
    assets.from_asset(
      constants.handle_policy_id,
      constants.prefixed_asset_name(constants.lbl_222, suffix),
      1,
    )

  transaction.Input {
    output_reference: transaction.OutputReference {
      transaction_id: tx_id,
      output_index,
    },
    output: transaction.Output {
      address: address.from_script(#"bb"),
      value,
      datum: transaction.InlineDatum(root_data),
      reference_script: None,
    },
  }
}

fn fixture_reference_input_for_wrong_token(
  tx_id: ByteArray,
  output_index: Int,
) -> transaction.Input {
  let root_data: Data = fixture_root()
  let value =
    assets.from_asset(
      constants.handle_policy_id,
      constants.prefixed_asset_name(constants.lbl_222, "wrong_policy_ids"),
      1,
    )

  transaction.Input {
    output_reference: transaction.OutputReference {
      transaction_id: tx_id,
      output_index,
    },
    output: transaction.Output {
      address: address.from_script(#"bb"),
      value,
      datum: transaction.InlineDatum(root_data),
      reference_script: None,
    },
  }
}

fn fixture_tx(
  reference_inputs: List<transaction.Input>,
) -> transaction.Transaction {
  transaction.Transaction { ..transaction.placeholder, reference_inputs }
}

test load_policy_index_root_enforces_expected_token_suffix() {
  let settings = fixture_settings()
  let tx =
    fixture_tx(
      [
        fixture_reference_input_for_wrong_token(
          #"0101010101010101010101010101010101010101010101010101010101010101",
          0,
        ),
      ],
    )

  load_policy_index_root(0, key_policy_ids_bg, settings.pz_providers, settings.settings_cred, tx) == None
}

test load_policy_index_root_accepts_bg_and_pfp_suffixes() {
  let settings = fixture_settings()
  let root = fixture_root()
  let tx =
    fixture_tx(
      [
        fixture_reference_input_for_root(
          #"0202020202020202020202020202020202020202020202020202020202020202",
          0,
          key_policy_ids_bg,
          root,
        ),
        fixture_reference_input_for_root(
          #"0303030303030303030303030303030303030303030303030303030303030303",
          1,
          key_policy_ids_pfp,
          root,
        ),
      ],
    )

  and {
    load_policy_index_root(0, key_policy_ids_bg, settings.pz_providers, settings.settings_cred, tx) == Some(root),
    load_policy_index_root(1, key_policy_ids_pfp, settings.pz_providers, settings.settings_cred, tx) == Some(root),
  }
}

test approval_status_for_empty_asset_is_not_required() {
  let pz_assets = assets.zero
  approval_status_for_asset(
    Some(fixture_root()),
    datum.empty_asset,
    pz_assets,
    None,
  ) == personalize_policy_approval.ApprovalNotRequired
}

test approval_status_rejects_missing_proof_for_non_empty_asset() {
  let asset =
    datum.AssetClass { policy_id: fixture_policy_id(), asset_name: "bg_token" }
  let pz_assets = assets.from_asset(fixture_policy_id(), asset.asset_name, 1)

  approval_status_for_asset(Some(fixture_root()), asset, pz_assets, None) == personalize_policy_approval.ApprovalRejected
}

test approval_status_rejects_when_asset_not_in_output() {
  let asset =
    datum.AssetClass { policy_id: fixture_policy_id(), asset_name: "bg_token" }
  let pz_assets = assets.zero
  let approval =
    policy_index_types.PolicyApprovalProof {
      policy_nsfw: 0,
      policy_proof: [],
      override: policy_index_types.NoOverride { proof: [] },
    }

  approval_status_for_asset(
    Some(fixture_root()),
    asset,
    pz_assets,
    Some(approval),
  ) == personalize_policy_approval.ApprovalRejected
}

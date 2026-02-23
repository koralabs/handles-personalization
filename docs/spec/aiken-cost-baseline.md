# Aiken Cost Baseline

Snapshot date: 2026-02-23

These baselines come from:
- `cd aiken && aiken check -m personalization/policy_index_mpf --trace-level silent`
- `cd aiken && aiken check -m personalization/update --trace-level silent`
- `cd aiken && aiken check -m personalization/personalize_mpf_context --trace-level silent`
- `cd aiken && aiken check -m personalization/personalize_policy_approval --trace-level silent`
- `cd aiken && aiken check -m personalization/personalize_base --trace-level silent`

## MPF Verification

| Test | Mem | CPU |
| --- | ---: | ---: |
| `verify_policy_approval_accepts_valid_bg_proof` | 92,205 | 27,701,205 |
| `verify_policy_approval_rejects_bad_proof` | 161,187 | 49,616,676 |
| `verify_policy_approval_rejects_policy_mismatch` | 52,114 | 14,867,630 |

## UPDATE Branch Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `update_is_valid_private_root_signed_branch` | 159,482 | 68,714,804 |
| `update_is_valid_public_root_signed_expired_branch` | 141,693 | 60,717,974 |
| `update_is_valid_assignee_branch` | 300,257 | 128,259,896 |

## Redeemer Dispatch Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `dispatch_redeemer_return_to_sender_branch` | 112,504 | 33,326,122 |
| `dispatch_redeemer_migrate_branch_enforces_owner_requirement` | 123,197 | 42,172,169 |
| `dispatch_redeemer_revoke_branch_uses_revoke_rules` | 91,405 | 31,876,001 |
| `dispatch_redeemer_update_branch_cost_probe` | 79,433 | 27,959,629 |
| `dispatch_redeemer_personalize_branch_cost_probe` | 239,015 | 94,644,171 |

## Tx-Aware Dispatch (`dispatch_from_tx`)

| Test | Mem | CPU |
| --- | ---: | ---: |
| `dispatch_from_tx_return_to_sender_uses_settings_admin_gate` | 321,149 | 97,466,524 |
| `dispatch_from_tx_return_to_sender_rejects_forbidden_assets` | 209,487 | 60,988,335 |
| `dispatch_from_tx_migrate_branch_respects_owner_sig_requirement` | 598,804 | 189,096,123 |
| `dispatch_from_tx_revoke_branch_uses_mint_burn_quantity` | 566,078 | 174,543,757 |
| `dispatch_from_tx_update_branch_requires_settings_tokens` | 341,176 | 106,349,552 |
| `dispatch_from_tx_update_branch_accepts_private_root_address_change` | 936,227 | 294,415,388 |
| `dispatch_from_tx_personalize_branch_is_wired_through_context_parser` | 501,996 | 165,508,417 |

## PERSONALIZE MPF Context Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `load_policy_index_root_accepts_bg_and_pfp_suffixes` | 172,967 | 57,455,851 |
| `approval_status_for_asset_accepts_precomputed_bg_and_pfp_proofs` | 372,766 | 123,256,533 |
| `approval_status_for_asset_rejects_missing_proof_for_non_empty_asset` | 48,409 | 16,803,118 |

## PERSONALIZE Branch Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `personalize_is_valid_non_reset_cost_probe` | 193,248 | 79,689,159 |
| `personalize_is_valid_reset_cost_probe` | 250,746 | 100,631,332 |

## PERSONALIZE Policy Approval Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `policy_datum_is_valid_accepts_valid_flags_and_image_rules` | 67,939 | 25,256,647 |
| `policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches` | 59,561 | 21,321,990 |

## PERSONALIZE Base Helper

| Test | Mem | CPU |
| --- | ---: | ---: |
| `fees_are_paid_matches_grace_and_payment_rules` | 65,018 | 24,422,772 |
| `reset_privacy_is_valid_matches_holder_change_requirements` | 60,588 | 23,570,042 |

## Regression Guard Linkage

`tests/aiken.cost.test.js` enforces ceilings for all rows above.

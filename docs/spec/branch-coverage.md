# Branch Coverage Matrix

This document tracks branch-intent coverage for the Aiken migration.

Generated baseline: 2026-02-23

## Aiken Intent Coverage

Status values:
- `covered`: directly asserted by Aiken module tests and/or Helios-vs-Aiken parity vectors.
- `covered-legacy-parity`: covered through the dual-run parity runner mapping to legacy Helios scenarios.
- `covered-conditional`: mapped and cataloged, but execution depends on unstable external test infra (`tests/txTests.ts` upstream 503 path).

| Intent | Status | Aiken Coverage | Parity Mapping |
| --- | --- | --- | --- |
| PERSONALIZE handle/redeemer name gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | `personalize_handle_redeemer_mismatch` |
| PERSONALIZE expected handle token gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | `personalize_main_happy_path` |
| PERSONALIZE owner-handle presence gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | `personalize_handle_missing` |
| PERSONALIZE resolved-ada non-virtual prohibition | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | `personalize_handle_missing` |
| PERSONALIZE virtual assignee signature gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | covered in module test (no dedicated parity vector yet) |
| PERSONALIZE virtual resolved-address unchanged gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | covered in module test (no dedicated parity vector yet) |
| PERSONALIZE virtual payload unchanged gate | covered | `personalization/update` test `personalize_is_valid_common_and_virtual_gates` | covered in module test (no dedicated parity vector yet) |
| PERSONALIZE contract-output validity gate | covered | `personalization/update` test `personalize_is_valid_rejects_contract_or_policy_failures` | `personalize_immutables_changed`, `personalize_agreed_terms_changed` |
| PERSONALIZE immutables/agreed-terms gate | covered | `personalization/update` test `personalize_is_valid_rejects_contract_or_policy_failures` | `personalize_immutables_changed`, `personalize_agreed_terms_changed` |
| PERSONALIZE MPF root token/credential gate | covered | `personalization/personalize_mpf_context` tests `load_policy_index_root_enforces_expected_token_suffix`, `load_policy_index_root_accepts_bg_and_pfp_suffixes` | `personalize_policy_root_gate` |
| PERSONALIZE MPF proof-required gate for non-empty assets | covered | `personalization/personalize_mpf_context` test `approval_status_for_asset_rejects_missing_proof_for_non_empty_asset` | covered in module test |
| PERSONALIZE MPF acceptance for BG/PFP proofs | covered | `personalization/personalize_mpf_context` test `approval_status_for_asset_accepts_precomputed_bg_and_pfp_proofs` | covered in module test |
| PERSONALIZE policy datum bg/pfp image symmetry | covered | `personalization/personalize_policy_approval` test `policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches` | `personalize_bg_image_mismatch`, `personalize_pfp_image_mismatch` |
| PERSONALIZE policy datum trial/nsfw derivation consistency | covered | `personalization/personalize_policy_approval` tests `policy_datum_is_valid_accepts_valid_flags_and_image_rules`, `policy_datum_is_valid_rejects_approval_or_flag_mismatch` | covered in module tests |
| PERSONALIZE non-reset designer-changed authorization path | covered | `personalization/update` test `personalize_is_valid_non_reset_designer_change_branch` | `personalize_main_happy_path` |
| PERSONALIZE non-reset designer-unchanged/reset-shape path | covered | `personalization/update` test `personalize_is_valid_non_reset_designer_unchanged_or_reset_shape_branch` | covered in module test |
| PERSONALIZE reset privacy checks | covered-legacy-parity | `personalization/update` test `personalize_is_valid_reset_privacy_and_authorization_branches` | `reset_happy_path`, `reset_socials_holder_change`, `reset_resolved_holder_change`, `reset_socials_unauthorized`, `reset_resolved_unauthorized` |
| PERSONALIZE reset authorization checks | covered-legacy-parity | `personalization/update` test `personalize_is_valid_reset_privacy_and_authorization_branches` | `reset_not_allowed_when_good`, `reset_happy_path` |
| PERSONALIZE tx-aware dispatch wiring | covered | `personalization/update` test `dispatch_from_tx_personalize_branch_is_wired_through_context_parser` | `personalize_main_happy_path` |
| MIGRATE admin signer + owner-token requirement branching | covered-legacy-parity | `personalization/update` tests `dispatch_redeemer_migrate_branch_enforces_owner_requirement`, `dispatch_from_tx_migrate_branch_respects_owner_sig_requirement` | `migrate_admin_no_owner`, `migrate_hardcoded_admin`, `migrate_wrong_admin_signer`, `migrate_no_admin_signers`, `migrate_owner_token_required` |
| REVOKE virtual-only + root/public-expiry + burn quantity | covered | `personalization/revoke` suite + `personalization/update` test `dispatch_from_tx_revoke_branch_uses_mint_burn_quantity` | `tx_revoke_private_mint_signed_by_root` (conditional), `tx_revoke_public_not_expired` (conditional) |
| UPDATE settings-token + signer/payment branching | covered | `personalization/update` tests `update_is_valid_*`, `dispatch_from_tx_update_branch_requires_settings_tokens`, `dispatch_from_tx_update_branch_accepts_private_root_address_change` | `tx_update_private_mint_address_changed` (conditional), `tx_update_protocol_settings_token_required` (conditional) |
| RETURN_TO_SENDER admin + forbidden-token guard | covered-legacy-parity | `personalization/update` tests `dispatch_from_tx_return_to_sender_uses_settings_admin_gate`, `dispatch_from_tx_return_to_sender_rejects_forbidden_assets` | `return_to_sender_wrong_admin`, `return_to_sender_forbidden_token`, `return_to_sender_all_good` |
| Compiler-safe tx-aware PERSONALIZE decomposition constraint | covered | `tests/aiken.compilerConstraints.test.js`, `personalization/personalize_mpf_context` module split | covered in compiler-constraint suite |

## Parity Runner Outputs

Dual-run artifacts are generated by:
- `npm run test:parity`

Outputs:
- `tests/reports/parity-report.json`
- `tests/reports/parity-report.md`

These reports are the source of truth for Helios-vs-Aiken mapped branch-intent parity in the current migration phase.

## Legacy Message Guard

The legacy message-coverage guard remains available at:
- `tests/contract.messages.test.js`

It enforces covered-or-unreachable classification for the current Helios error-message surface while Aiken message-intent mapping continues under Epic E/F.

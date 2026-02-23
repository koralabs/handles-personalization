# Helios vs Aiken Parity Report

Generated: 2026-02-23T06:11:12.943Z

Summary: 22/22 executable mapped branch intents passed
Skipped vectors: 4

| ID | Source | Helios | Aiken | Status |
| --- | --- | --- | --- | --- |
| migrate_admin_no_owner | tests.js | MIGRATE / admin, no owner (success) | personalization/update / dispatch_from_tx_migrate_branch_respects_owner_sig_requirement (pass) | pass |
| migrate_hardcoded_admin | tests.js | MIGRATE / hardcoded admin (success) | personalization/update / dispatch_from_tx_migrate_branch_respects_owner_sig_requirement (pass) | pass |
| migrate_wrong_admin_signer | tests.js | MIGRATE / wrong admin signer (success) | personalization/update / dispatch_from_tx_migrate_branch_respects_owner_sig_requirement (pass) | pass |
| migrate_no_admin_signers | tests.js | MIGRATE / no admin signers (success) | personalization/update / dispatch_from_tx_migrate_branch_respects_owner_sig_requirement (pass) | pass |
| migrate_owner_token_required | tests.js | MIGRATE / owner signature required but owner token missing (success) | personalization/update / dispatch_from_tx_migrate_branch_respects_owner_sig_requirement (pass) | pass |
| return_to_sender_wrong_admin | tests.js | RETURN_TO_SENDER / wrong admin signer (success) | personalization/update / dispatch_from_tx_return_to_sender_uses_settings_admin_gate (pass) | pass |
| return_to_sender_forbidden_token | tests.js | RETURN_TO_SENDER / can't return a handle reference token (success) | personalization/update / dispatch_from_tx_return_to_sender_rejects_forbidden_assets (pass) | pass |
| return_to_sender_all_good | tests.js | RETURN_TO_SENDER / all good (success) | personalization/update / dispatch_from_tx_return_to_sender_uses_settings_admin_gate (pass) | pass |
| personalize_main_happy_path | tests.js | PERSONALIZE / main (success) | personalization/update / dispatch_redeemer_personalize_branch_uses_personalize_rules (pass) | pass |
| personalize_handle_redeemer_mismatch | tests.js | PERSONALIZE / handle redeemer mismatch (success) | personalization/update / personalize_is_valid_common_and_virtual_gates (pass) | pass |
| personalize_handle_missing | tests.js | PERSONALIZE / handle missing (success) | personalization/update / personalize_is_valid_common_and_virtual_gates (pass) | pass |
| personalize_policy_root_gate | tests.js | PERSONALIZE / bg_policy_ids missing (success) | personalization/personalize_mpf_context / load_policy_index_root_enforces_expected_token_suffix (pass) | pass |
| personalize_immutables_changed | tests.js | PERSONALIZE / immutables changed (success) | personalization/update / personalize_is_valid_rejects_contract_or_policy_failures (pass) | pass |
| personalize_agreed_terms_changed | tests.js | PERSONALIZE / agreed terms changed (success) | personalization/update / personalize_is_valid_rejects_contract_or_policy_failures (pass) | pass |
| personalize_bg_image_mismatch | tests.js | PERSONALIZE / bg_asset and bg_image mismatch (success) | personalization/personalize_policy_approval / policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches (pass) | pass |
| personalize_pfp_image_mismatch | tests.js | PERSONALIZE / pfp_asset and pfp_image mismatch (success) | personalization/personalize_policy_approval / policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches (pass) | pass |
| reset_happy_path | tests.js | RESET / no admin signer, pfp mismatch (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| reset_not_allowed_when_good | tests.js | RESET / reset not allowed because all good (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| reset_socials_holder_change | tests.js | RESET / socials must reset when holder changes (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| reset_resolved_holder_change | tests.js | RESET / resolved addresses must reset when holder changes (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| reset_socials_unauthorized | tests.js | RESET / socials cannot be reset without authorization (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| reset_resolved_unauthorized | tests.js | RESET / resolved addresses cannot be reset without authorization (success) | personalization/update / personalize_is_valid_reset_privacy_and_authorization_branches (pass) | pass |
| tx_update_private_mint_address_changed | txTests.ts | UPDATE / private mint address changed (missing) | personalization/update / dispatch_from_tx_update_branch_accepts_private_root_address_change (pass) | skipped: txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses |
| tx_update_protocol_settings_token_required | txTests.ts | UPDATE / protocol settings token required (missing) | personalization/update / dispatch_from_tx_update_branch_requires_settings_tokens (pass) | skipped: txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses |
| tx_revoke_private_mint_signed_by_root | txTests.ts | REVOKE / private mint and signed by root (missing) | personalization/update / dispatch_from_tx_revoke_branch_uses_mint_burn_quantity (pass) | skipped: txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses |
| tx_revoke_public_not_expired | txTests.ts | REVOKE / public mint not expired (missing) | personalization/revoke / revoke_is_valid_rejects_public_not_expired (missing) | skipped: txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses |

# Aiken Conversion Task List (Unattended Loop)

This backlog is designed for autonomous iteration. Complete tasks in order unless dependencies are satisfied.

## Loop Protocol
For each iteration:
1. Pick the next `pending` task with dependencies complete.
2. Implement only that task (or a tightly coupled pair).
3. Run required checks listed under `Validate`.
4. Commit with task ID in message.
5. Update this file task status and notes.

Status values:
- `pending`
- `in_progress`
- `blocked`
- `done`

---

## Epic A: Project Bootstrap

### A-001 Create Aiken workspace
- Status: `done`
- Depends on: none
- Deliverables:
  - `aiken/aiken.toml`
  - initial folder layout under `aiken/lib`, `aiken/validators`, `aiken/test`
- Validate:
  - `cd aiken && aiken check`
- Done when:
  - empty project compiles successfully.
- Notes:
  - Installed `aiken v1.1.21+42babe5`.
  - `cd aiken && aiken check` passes.

### A-002 Add MPF dependency
- Status: `done`
- Depends on: A-001
- Deliverables:
  - dependency entry for `aiken-lang/merkle-patricia-forestry`
  - lockfile updated
- Validate:
  - `cd aiken && aiken check`
- Done when:
  - MPF module imports resolve in a trivial test module.
- Notes:
  - Added dependency `aiken-lang/merkle-patricia-forestry@2.1.0`.
  - Added MPF smoke checks in `aiken/test/personalization.ak`.
  - `cd aiken && aiken check` compiles MPF and runs passing tests.

### A-003 Add compile/export scripts
- Status: `done`
- Depends on: A-001
- Deliverables:
  - root scripts to build Aiken validator artifacts alongside existing Helios artifacts
- Validate:
  - script execution produces expected Aiken build output
- Done when:
  - CI-friendly command exists for Aiken artifact build.
- Notes:
  - Added `compileAiken.js`, `getAikenArtifactPaths`, and npm scripts: `compile:aiken`, `compile:all`.
  - Added `tests/compileAiken.test.js` for Aiken artifact export validation.
  - Aiken build path uses `--trace-level silent` for fee-optimized artifacts.
  - `node --test tests/compile.test.js tests/compileAiken.test.js` passes.

---

## Epic B: Type and Utility Port

### B-001 Port constants and labels
- Status: `done`
- Depends on: A-001
- Deliverables:
  - `aiken/lib/personalization/constants.ak`
- Validate:
  - unit tests for constant sanity
- Done when:
  - constants match Helios values.
- Notes:
  - Added `aiken/lib/personalization/constants.ak` with Handle policy/labels and agreed-terms constants.
  - Added unit tests validating exact byte constants and label+suffix concatenation behavior.
  - `cd aiken && aiken check` passes.

### B-002 Port data types
- Status: `done`
- Depends on: A-001
- Deliverables:
  - `types.ak` with all core enums/records/redeemers
- Validate:
  - compile passes
- Done when:
  - all Helios domain types represented.
- Notes:
  - Added `aiken/lib/personalization/types.ak` with Handle/Redeemer/settings/datum model types.
  - Added unit tests to validate type variant construction.
  - `cd aiken && aiken check` passes.

### B-003 Port datum parsing helpers
- Status: `done`
- Depends on: B-002
- Deliverables:
  - helpers equivalent to `get_extra`, `get_datum`, `has_value_unwrapped`, asset parsing
- Validate:
  - Aiken unit tests for malformed/empty/expected datum shapes
- Done when:
  - helper behavior matches existing spec semantics.
- Notes:
  - Extended `aiken/lib/personalization/datum.ak` helper surface with compiler-safe equivalents:
    - `get_datum_opt` (tx-aware datum resolution with `Option<Data>`),
    - `map_get`,
    - `int_or`,
    - `has_value_unwrapped`.
  - Added unit coverage for malformed/empty/expected shapes:
    - `get_extra` map/constructor-empty/malformed fallback handling,
    - inline/hash-missing datum-resolution behavior via `get_datum_opt`,
    - missing-key and fallback behavior via `map_get` + `int_or`,
    - `has_value_unwrapped` int/non-empty-bytes/list branches,
    - asset split helper (`parse_asset_bytes`).
  - Kept compiler-safe implementation strategy under Aiken `v1.1.21` constraints:
    - avoid `Option<Data> -> (Bool, Data)` signatures that still trigger silent compiler exits,
    - use `Option<Data>`/typed fallback helpers for call-site composition.

### B-004 Port generic validation helpers
- Status: `done`
- Depends on: B-003
- Deliverables:
  - equivalents of `holder_addresses_match`, `is_valid_contract`, `admin_has_signed_tx`, etc.
- Validate:
  - unit tests for each helper branch
- Done when:
  - helper test suite is green.
- Notes:
  - Added `aiken/lib/personalization/utils.ak`.
  - Implemented helpers:
    - `holder_addresses_match`,
    - `is_valid_contract`,
    - `admin_has_signed_tx`,
    - `get_virtual_price`.
  - Added branch tests for payment/stake matching, contract credential checks, admin signature paths, and tier-price selection.
  - `cd aiken && aiken check` passes with helper module coverage.

---

## Epic C: MPF Policy Index Integration

### C-001 Define PMF datum/redeemer proof schema
- Status: `done`
- Depends on: B-002
- Deliverables:
  - Aiken types for `PolicyIndexRoot`, `PolicyFlags`, `PolicyApprovalProof`
  - doc update for ABI
- Validate:
  - serialization/deserialization tests
- Done when:
  - schema frozen with version field.
- Notes:
  - Added `aiken/lib/personalization/policy_index_types.ak` with:
    - `PolicyIndexRoot`,
    - `PolicyFlags`,
    - `PolicyApprovalProof`,
    - `policy_index_schema_version = 1`.
  - Added roundtrip serialization tests for all schema types.
  - Updated `docs/spec/aiken-conversion-spec.md` to reference frozen schema module + version constant.

### C-002 Implement MPF proof verification helper
- Status: `done`
- Depends on: C-001, A-002
- Deliverables:
  - `policy_index_mpf.ak` with `verify_policy_approval(...)`
- Validate:
  - tests: valid proof, bad root, bad proof, policy mismatch, prefix mismatch, flags mismatch
- Done when:
  - helper covers both bg/pfp proof verification.
- Notes:
  - Added `aiken/lib/personalization/policy_index_mpf.ak`.
  - Implemented:
    - `policy_index_key(policy_id, prefix)`,
    - `encode_policy_flags(flags)`,
    - `verify_policy_approval(root, token_policy_id, token_name, approval)`.
  - Added focused unit tests for:
    - valid BG proof,
    - bad root,
    - bad proof,
    - policy mismatch,
    - prefix mismatch,
    - flags mismatch,
    - valid PFP proof.
  - Optimization pass:
    - fail-fast cheap guards before MPF calls (`version`, root/policy length, policy match, prefix match),
    - compact deterministic flag encoding for trie values,
    - added tests for compact encoding stability and malformed root/policy length rejection.

### C-003 Replace map-based approver logic in PERSONALIZE
- Status: `done`
- Depends on: C-002
- Deliverables:
  - PERSONALIZE code path uses MPF proofs for BG/PFP approval + flags
- Validate:
  - targeted PERSONALIZE tests for approval and nsfw/trial derivation
- Done when:
  - no map-based approver dependency remains in validator.
- Notes:
  - Added `aiken/lib/personalization/personalize_policy_approval.ak` with:
    - `verify_selected_asset` (proof-required semantics for non-empty assets),
    - `derive_trial_nsfw` (Helios-equivalent boolean aggregation),
    - `approvals_are_valid`,
    - `policy_datum_is_valid` (validated-by signer gate, trial/nsfw derivation parity, bg/pfp image symmetry, and datum-image match gates).
  - Added unit tests for required-proof branches, invalid proof rejection, trial/nsfw derivation, validated-by signer checks, and bg/pfp image consistency branches.
  - Wired approval helpers into compiler-safe PERSONALIZE branch helper:
    - `aiken/lib/personalization/update.ak` -> `personalize_is_valid` + `dispatch_redeemer` `Personalize` route.
    - PERSONALIZE flow now consumes `AssetApprovalStatus` values derived from MPF proof checks (`verify_selected_asset`) and enforces `policy_datum_is_valid`.
  - Map-backed approver datum dependency removed from PERSONALIZE helper path; only MPF-backed approval status inputs remain in Aiken PERSONALIZE validation logic.

### C-004 Off-chain proof builder adapter
- Status: `done`
- Depends on: C-001
- Deliverables:
  - JS utility that constructs MPF proofs and serializes proof payload into redeemer shape
- Validate:
  - integration test with known trie root and known inclusion proof
- Done when:
  - deterministic proof vectors can be generated for tests.
- Notes:
  - Added `mpfProofAdapter.js`:
    - `policyIndexKey`,
    - `encodePolicyFlags`,
    - `buildPolicyIndexTrie`,
    - `buildPolicyApprovalProof`,
    - `proofJsonToAikenProof`,
    - `buildPolicyApprovalRedeemer`.
  - Added `tests/mpfProofAdapter.test.js` with deterministic root/proof vectors and redeemer-shape serialization checks.

---

## Epic D: Redeemer Flow Port

### D-001 Port PERSONALIZE base flow (non-MPF parts)
- Status: `done`
- Depends on: B-004
- Deliverables:
  - Aiken PERSONALIZE path preserving non-approver semantics
- Validate:
  - unit tests for handle match, immutables, fee checks, virtual constraints, reset auth
- Done when:
  - PERSONALIZE path compiles and passes targeted tests.
- Notes:
  - Added `aiken/lib/personalization/personalize_base.ak` with tested building blocks for:
    - datum/redeemer handle-name matching,
    - handle label mapping by `HandleType`,
    - expected handle token presence checks in output value,
    - resolved-address ADA gating by handle type,
    - subhandle enablement gates,
    - immutable check aggregation,
    - non-reset authorization branches,
    - reset privacy rules,
    - reset authorization rules,
    - fee gates (grace bypass, treasury/provider/root payment requirements),
    - shared subhandle fee calculation.
  - Added PERSONALIZE branch integrator in `aiken/lib/personalization/update.ak`:
    - `PersonalizeValidationInputs`,
    - `personalize_is_valid`,
    - virtual-only gate helper (`virtual_personalization_rules_are_valid`),
    - dispatch integration for `Redeemer::Personalize`.
  - Added PERSONALIZE branch tests covering:
    - non-reset designer-changed and designer-unchanged paths,
    - common gating (name/output/owner/subhandle/resolved-address),
    - virtual signature + immutable virtual payload gates,
    - reset privacy + reset authorization branches.
  - Remaining work:
    - wrap helper flow in real `validator { ... }` branch once compiler blocker is resolved.

### D-002 Integrate MPF into PERSONALIZE end-to-end
- Status: `blocked`
- Depends on: D-001, C-003
- Deliverables:
  - full PERSONALIZE behavior with MPF-backed policy checks
- Validate:
  - integration scenarios for bg/pfp proof combinations
- Done when:
  - PERSONALIZE parity with Helios scenarios is achieved.
- Notes:
  - Blocked by Aiken compiler `v1.1.21` silent-exit behavior when expanding the tx-aware PERSONALIZE path from helper-level checks into full on-chain context parsing.
  - Repro status:
    - validator forwarding to `update.dispatch_from_tx` compiles in `aiken/validators/personalization.ak`,
    - tx-aware `RETURN_TO_SENDER`, `MIGRATE`, `REVOKE`, `UPDATE` paths compile and test green,
    - extending tx-aware `PERSONALIZE` beyond current staged helper path still needs compiler-safe decomposition.
  - Workaround in use:
    - keep PERSONALIZE logic in helper-level pure functions with full unit coverage,
    - keep tx-aware dispatch enabled for unblocked redeemers in validator,
    - continue decomposing PERSONALIZE into smaller compiler-safe units.

### D-003 Port MIGRATE
- Status: `in_progress`
- Depends on: B-004
- Deliverables:
  - Aiken MIGRATE branch
- Validate:
  - tests for admin required, owner-sign-required, invalid migration
- Done when:
  - MIGRATE parity scenarios pass.
- Notes:
  - Added `aiken/lib/personalization/migrate.ak` with `migrate_is_valid`.
  - Added `migration_signers_are_valid` helper for admin/owner-sign-required branching.
  - Added branch tests for changed datum, token mismatch, invalid contract, and signer failure.
  - Integrated into both helper and tx-aware dispatch:
    - `aiken/lib/personalization/update.ak` -> `dispatch_redeemer` and `dispatch_from_tx`,
    - covered by `dispatch_from_tx_migrate_branch_respects_owner_sig_requirement`.
  - Validator wiring active via `aiken/validators/personalization.ak` -> `update.dispatch_from_tx`.
  - Remaining work: parity harness scenario mapping (`E-001`/`E-002`) and error-intent matrix rebuild (`E-003`).

### D-004 Port REVOKE
- Status: `in_progress`
- Depends on: B-004
- Deliverables:
  - Aiken REVOKE branch
- Validate:
  - tests for private/public/expiry and wrong handle type
- Done when:
  - REVOKE parity scenarios pass.
- Notes:
  - Added `aiken/lib/personalization/revoke.ak` with `revoke_is_valid`.
  - Added tests for virtual-only gating, private/public revoke paths, expiry behavior, and mint burn quantity checks.
  - Integrated into both helper and tx-aware dispatch:
    - `aiken/lib/personalization/update.ak` -> `dispatch_redeemer` and `dispatch_from_tx`,
    - covered by `dispatch_from_tx_revoke_branch_uses_mint_burn_quantity`.
  - Validator wiring active via `aiken/validators/personalization.ak` -> `update.dispatch_from_tx`.
  - Remaining work: parity harness scenario mapping (`E-001`/`E-002`) and error-intent matrix rebuild (`E-003`).

### D-005 Port UPDATE
- Status: `in_progress`
- Depends on: B-004
- Deliverables:
  - Aiken UPDATE branch
- Validate:
  - tests for restricted changes, signer paths, payment paths, settings token checks
- Done when:
  - UPDATE parity scenarios pass.
- Notes:
  - Replaced bootstrap module with `aiken/lib/personalization/update.ak` and implemented `update_is_valid`.
  - Added tests covering:
    - restricted-change and settings-token gates,
    - private root-signed branch,
    - public root-signed expired branch,
    - assignee signer branch,
    - no-signature rejection.
  - Added compiler-safe branch dispatch:
    - `dispatch_redeemer` in `aiken/lib/personalization/update.ak`,
    - branch tests for `RETURN_TO_SENDER`, `MIGRATE`, `REVOKE`, and `UPDATE` dispatch paths.
  - Added tx-aware UPDATE path in `dispatch_from_tx` with fail-fast gates and staged context parsing.
  - Added tx-aware UPDATE tests:
    - `dispatch_from_tx_update_branch_requires_settings_tokens`,
    - `dispatch_from_tx_update_branch_accepts_private_root_address_change`.
  - Remaining work: parity harness scenario mapping (`E-001`/`E-002`) and full payment-path parity expansion.

### D-006 Port RETURN_TO_SENDER
- Status: `in_progress`
- Depends on: B-004
- Deliverables:
  - Aiken RETURN_TO_SENDER branch
- Validate:
  - tests for admin requirement and forbidden token filters
- Done when:
  - RETURN_TO_SENDER parity scenarios pass.
- Notes:
  - Added `aiken/lib/personalization/return_to_sender.ak`.
  - Added branch tests for admin signer requirement and forbidden `LBL_100` / `LBL_001` token filtering across outputs.
  - Integrated into both helper and tx-aware dispatch:
    - `aiken/lib/personalization/update.ak` -> `dispatch_redeemer` and `dispatch_from_tx`.
  - Added tx-aware tests:
    - `dispatch_from_tx_return_to_sender_uses_settings_admin_gate`,
    - `dispatch_from_tx_return_to_sender_rejects_forbidden_assets`.
  - Validator wiring active via `aiken/validators/personalization.ak` -> `update.dispatch_from_tx`.
  - Remaining work: parity harness scenario mapping (`E-001`/`E-002`) and error-intent matrix rebuild (`E-003`).

---

## Epic E: Parity and Regression Harness

### E-001 Build dual-run parity runner
- Status: `pending`
- Depends on: D-002, D-003, D-004, D-005, D-006
- Deliverables:
  - test runner executing equivalent fixtures against Helios and Aiken validators
- Validate:
  - report of pass/fail parity by scenario
- Done when:
  - parity report generated in CI.

### E-002 Port legacy scenario vectors
- Status: `pending`
- Depends on: E-001
- Deliverables:
  - mapped scenario set from `tests/tests.js` and stable subset of `tests/txTests.ts`
- Validate:
  - per-scenario parity assertion
- Done when:
  - all reachable branch intents are represented.

### E-003 Rebuild branch coverage matrix for Aiken
- Status: `pending`
- Depends on: E-002
- Deliverables:
  - updated `docs/spec/branch-coverage.md` with Aiken test mapping
- Validate:
  - no `missing` rows for reachable branches
- Done when:
  - matrix is complete and reviewed.

### E-004 Keep contract message coverage guard green
- Status: `pending`
- Depends on: E-002
- Deliverables:
  - equivalent message coverage test for Aiken error intents
- Validate:
  - `node --test` message-coverage guard passes
- Done when:
  - guard enforces covered-or-unreachable rule.

---

## Epic F: Performance and Deployment Readiness

### F-001 Cost benchmarking
- Status: `in_progress`
- Depends on: C-002
- Deliverables:
  - mem/cpu benchmarks for critical flows (especially PERSONALIZE + MPF proof verification)
- Validate:
  - benchmark output checked into docs/report
- Done when:
  - costs are within acceptable range for transaction budgets.
- Notes:
  - Added baseline report: `docs/spec/aiken-cost-baseline.md`.
  - Current baseline covers:
    - MPF proof verification hot paths,
    - UPDATE helper hot paths,
    - dispatch helper hot paths (including PERSONALIZE route),
    - PERSONALIZE policy-datum helper hot paths,
    - PERSONALIZE branch helper hot paths.
  - Remaining work: capture end-to-end PERSONALIZE validator branch costs after validator wiring.

### F-004 Cost guard thresholds in CI
- Status: `in_progress`
- Depends on: F-001
- Deliverables:
  - baseline execution-unit snapshots for critical Aiken tests
  - regression guard that fails when CPU/mem exceeds configured threshold
- Validate:
  - CI/local test command fails on budget regressions
- Done when:
  - budget regression guard is active for MPF approval and PERSONALIZE hot paths.
- Notes:
  - Added guard test suite: `tests/aiken.cost.test.js`.
  - Current guard enforces ceilings for:
    - `verify_policy_approval_accepts_valid_bg_proof`,
    - `verify_policy_approval_rejects_bad_proof`,
    - `verify_policy_approval_rejects_policy_mismatch`,
    - `update_is_valid_private_root_signed_branch`,
    - `update_is_valid_public_root_signed_expired_branch`,
    - `update_is_valid_assignee_branch`,
    - `dispatch_redeemer_return_to_sender_branch`,
    - `dispatch_redeemer_migrate_branch_enforces_owner_requirement`,
    - `dispatch_redeemer_revoke_branch_uses_revoke_rules`,
    - `dispatch_redeemer_update_branch_cost_probe`,
    - `personalize_is_valid_non_reset_cost_probe`,
    - `personalize_is_valid_reset_cost_probe`,
    - `dispatch_redeemer_personalize_branch_cost_probe`,
    - `dispatch_from_tx_return_to_sender_uses_settings_admin_gate`,
    - `dispatch_from_tx_return_to_sender_rejects_forbidden_assets`,
    - `dispatch_from_tx_migrate_branch_respects_owner_sig_requirement`,
    - `dispatch_from_tx_revoke_branch_uses_mint_burn_quantity`,
    - `dispatch_from_tx_update_branch_requires_settings_tokens`,
    - `dispatch_from_tx_update_branch_accepts_private_root_address_change`,
    - `policy_datum_is_valid_accepts_valid_flags_and_image_rules`,
    - `policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches`,
    - `fees_are_paid_matches_grace_and_payment_rules`,
    - `reset_privacy_is_valid_matches_holder_change_requirements`.
  - Remaining work: add full validator PERSONALIZE path ceilings once branch integration is complete.

### F-002 Artifact and address generation
- Status: `pending`
- Depends on: D-002, D-003, D-004, D-005, D-006
- Deliverables:
  - build script generating Aiken validator artifacts for deployment workflows
- Validate:
  - deterministic artifact generation in clean environment
- Done when:
  - artifacts can be consumed by deployment tooling.

### F-003 Migration playbook
- Status: `pending`
- Depends on: E-003, F-002
- Deliverables:
  - operational migration doc (ABI changes, datum/redeemer rollout, proof service rollout)
- Validate:
  - reviewed checklist with rollback steps
- Done when:
  - migration plan is actionable by ops without code changes.

---

## Fast-Start Queue (Recommended next 8 tasks)
1. A-001
2. A-002
3. B-001
4. B-002
5. C-001
6. C-002
7. D-001
8. D-003

# Aiken Migration Playbook

Generated: 2026-02-23

## Objective

Cut over `handles-personalization` from Helios to Aiken while preserving branch intent, MPF approval semantics, and deployment reproducibility.

## Deployment Artifacts

Generate artifacts with:
- `npm run compile:aiken`

Required outputs:
- `contract/aiken.plutus.json`
- `contract/aiken.validators.json`
- `contract/aiken.addresses.json`
- `contract/aiken.spend.hash`
- `contract/aiken.spend.addr_testnet`
- `contract/aiken.spend.addr_mainnet`

These files are deterministic and should be treated as release artifacts.

## ABI / Data Changes

### Redeemer compatibility mode

`Redeemer::Personalize` shape remains unchanged.

MPF proofs are carried in reserved keys under `designer`:
- `__bg_proof`
- `__pfp_proof`

### Policy index reference datum

`bg_policy_ids` and `pfp_policy_ids` reference UTxOs now use:
- `PolicyIndexRoot { root: ByteArray, version: Int }`

### Proof payload shape

Proof payload uses:
- `PolicyApprovalProof { policy_id, prefix, flags, proof }`
- `PolicyFlags { nsfw, trial, aux }`

## Rollout Plan

1. Pre-cutover freeze
- Freeze policy-index writer and proof-service code revisions.
- Freeze client payload schemas for `designer` proof keys.

2. Shadow parity run
- Run `npm run test:parity` and archive:
  - `tests/reports/parity-report.json`
  - `tests/reports/parity-report.md`
- Require `failed = 0` for executable vectors.

3. Artifact release
- Run `npm run compile:aiken` in a clean environment.
- Publish artifacts and script hash/address bundle from `contract/`.

4. Reference-input migration
- Create/update `bg_policy_ids` and `pfp_policy_ids` UTxOs to `PolicyIndexRoot` datum format.
- Preserve token identity checks (`LBL_222 + bg_policy_ids`, `LBL_222 + pfp_policy_ids`).

5. Proof-service cutover
- Switch proof service to MPF root/proof output for BG/PFP selection.
- Ensure payload encoder populates `__bg_proof` and `__pfp_proof` in `designer`.

6. Transaction builder cutover
- Switch validation target script hash/address to Aiken `*.spend` artifact.
- Keep Helios path behind a fast rollback flag for one release window.

7. Post-cutover monitoring
- Track failed tx categories by branch intent:
  - root token presence/credential checks,
  - proof missing/proof invalid,
  - reset privacy/auth.
- Alert on sustained drift from Helios-era baseline rejection mix.

## Rollback Checklist

Trigger rollback if proof verification rejects valid known-good payloads, branch-intent rejection rates spike, or deployment artifact hash mismatch is detected.

Rollback steps:
1. Flip transaction builders back to Helios validator hash.
2. Disable Aiken route in any API/worker feature flags.
3. Keep proof service running but stop emitting Aiken-only rollout traffic.
4. Re-run Helios regression suite (`npm run test:old`) before reopening writes.
5. Preserve incident snapshot:
- tx samples,
- parity report,
- artifact hash bundle,
- proof payload samples.

## Operator Handoff

Before declaring migration complete:
- Archive exact commit SHA, artifact hashes, and parity report files.
- Record active script hash in deployment inventory.
- Record proof-service version and MPF root writer version in release notes.

# Aiken Conversion Spec

## Objective
Port `contract.helios` to Aiken while preserving the full behavioral intent documented in:
- `docs/spec/spec.md`
- `docs/spec/branch-coverage.md`

Additionally, replace in-datum `bg_policy_ids` / `pfp_policy_ids` map lookups with Merkle Patricia Forestry (MPF) proofs validated on-chain.

## Scope
- In scope:
  - Full validator rewrite in Aiken.
  - Equivalent behavior for all reachable contract branches.
  - PMF-backed policy approval checks for BG/PFP policy IDs.
  - Cost-first implementation choices to minimize CPU/memory and script size.
  - Updated tests and docs aligned to new ABI.
- Out of scope:
  - New product rules or feature additions.
  - Relaxing existing security checks.

## External Dependency
Use MPF as the canonical on-chain proof verifier:
- Repo: https://github.com/aiken-lang/merkle-patricia-forestry
- On-chain package path: `aiken-lang/merkle-patricia-forestry`
- API primitives to use:
  - `from_root(root: ByteArray)`
  - `has(trie, key, value, proof)`
  - `Proof` and `ProofStep` types

Reference docs:
- Root README: https://github.com/aiken-lang/merkle-patricia-forestry
- On-chain README: https://github.com/aiken-lang/merkle-patricia-forestry/blob/main/on-chain/README.md

## Compatibility Contract

### Behavioral Compatibility
The Aiken validator must preserve the same policy intent as current Helios logic, including:
- redeemer branch semantics (`PERSONALIZE`, `MIGRATE`, `REVOKE`, `UPDATE`, `RETURN_TO_SENDER`)
- immutable field rules
- signer requirements
- fee and payout rules
- virtual subhandle constraints
- reset authorization and privacy safeguards

### Branch Coverage Compatibility
Every reachable branch/error condition listed as `covered` in `docs/spec/branch-coverage.md` must remain covered by tests after migration.

### Error Surface
Exact byte-for-byte error strings are desirable but not mandatory if Aiken runtime semantics require slight formatting differences.
Required outcome:
- each existing failure intent remains uniquely testable and mapped in branch coverage docs.

## Target Repository Layout
Add an Aiken project in-repo:

```text
aiken/
  aiken.toml
  validators/
    personalization.ak
  lib/
    personalization/
      types.ak
      constants.ak
      utils.ak
      datum.ak
      settings.ak
      personalize.ak
      personalize_base.ak
      personalize_policy_approval.ak
      migrate.ak
      revoke.ak
      update.ak
      return_to_sender.ak
      policy_index_mpf.ak
  test/
    personalization.ak
```

Keep existing Helios implementation until parity is reached.

## Data Model Mapping
Map current Helios structs/enums to Aiken types one-to-one where possible:
- `HandleType`, `Handle`
- `PzIndexes`, `VirtIndexes`
- `Redeemer` variants
- `PzSettings`, `OwnerSettings`, `MainSubHandleSettings`, `SubHandleSettings`
- `Datum::CIP68`

Use helper parsers for robust extraction from `Data` maps (`extra` field behavior must remain consistent with Helios fallback semantics).

## MPF Integration Design

### Current Behavior to Preserve
Current contract checks approver maps with semantics:
- approved when asset policy matches and token name starts with an approved prefix
- flags (`nsfw`, `trial`) are attached to matched prefix entries

### New On-Chain Shape
Keep the same reference UTxO token identity and credential checks, but change datum payload from full map to trie root descriptor.

#### Reference input datum
Use a compact root record for both `bg_policy_ids` and `pfp_policy_ids` UTxOs:

```text
PolicyIndexRoot {
  root: ByteArray  // 32 bytes MPF root hash
  version: Int     // schema version, start at 1
}
```

#### Personalize redeemer extension
Add proof carriers for the selected BG/PFP assets:

```text
PolicyApprovalProof {
  policy_id: ByteArray   // 28-byte policy id
  prefix: ByteArray      // token-name prefix (same semantics as current map key)
  flags: PolicyFlags
  proof: mpf.Proof
}

PolicyFlags {
  nsfw: Int   // 0|1
  trial: Int  // 0|1
  aux: Int    // preserve 3rd slot used by current []Int shape
}
```

`C-001` schema freeze reference:
- Aiken module: `aiken/lib/personalization/policy_index_types.ak`
- version constant: `policy_index_schema_version = 1`

`PERSONALIZE` receives optional BG/PFP proofs:
- required when corresponding asset exists
- omitted when corresponding asset is empty

### Key / Value Encoding
To preserve prefix semantics without requiring trie prefix-queries, prove membership of the matched prefix explicitly:
- key bytes: `policy_id || prefix`
- value bytes: deterministic encoding of `PolicyFlags` (canonical CBOR or fixed 3-byte format)

On-chain verification for a selected asset:
1. `mpf.has(mpf.from_root(root), key, value, proof) == True`
2. `asset.policy == policy_id`
3. `asset.token_name.starts_with(prefix)`

This exactly preserves “policy + starts_with(prefix)” approval logic.

Implementation reference:
- `aiken/lib/personalization/policy_index_mpf.ak` (`verify_policy_approval`)

### NSFW / Trial Derivation
Replace map-fold lookup with proof-derived flags:
- `bg_flags` from validated BG proof (or zero flags when no BG asset)
- `pfp_flags` from validated PFP proof (or zero flags when no PFP asset)
- keep existing invariant: datum `nsfw` and `trial` must equal computed totals.

## Branch-by-Branch Migration Requirements

### `PERSONALIZE`
Preserve all checks from current spec, with these substitutions:
- replace `get_approver_datum` + `asset_is_approved` map logic with MPF proof verification
- preserve provider/settings credential ownership checks for `bg_policy_ids` and `pfp_policy_ids` reference inputs
- preserve required-asset, designer CID/default enforcement, fees, reset behavior, and virtual constraints

### `MIGRATE`
No logic change beyond language port.

### `REVOKE`
No logic change beyond language port.

### `UPDATE`
No logic change beyond language port.

### `RETURN_TO_SENDER`
No logic change beyond language port.

## Off-Chain Requirements
Add a small off-chain adapter (JS/TS) to:
- fetch current MPF roots from `bg_policy_ids` / `pfp_policy_ids` UTxO datums
- build policy proof(s) with `@aiken-lang/merkle-patricia-forestry`
- serialize proofs into redeemer format expected by Aiken validator

Implementation reference:
- `mpfProofAdapter.js`
- `tests/mpfProofAdapter.test.js`

## Test Strategy

### 1. Parity Harness
Create dual-run tests that execute both contracts (Helios and Aiken) against equivalent fixtures and assert:
- same approve/deny outcome
- same failure intent classification (mapped message)

### 2. Branch Coverage
Rebuild `docs/spec/branch-coverage.md` for Aiken implementation and preserve coverage status for all currently-covered rows.

### 3. MPF-Specific Tests
Add focused cases for:
- valid inclusion proof for approved policy/prefix
- wrong root
- wrong proof
- wrong `policy_id`
- prefix mismatch against token name
- wrong flags payload

### 4. Regression/Constraint Tests
Retain and port all critical `PERSONALIZE`, `MIGRATE`, `REVOKE`, `UPDATE`, `RETURN_TO_SENDER` scenarios from current suites.

## Cost Optimization Rules (Mandatory)
Apply these rules in every ported path:
- Fail fast with cheapest checks first (schema/version/length/signer/index checks) before proof validation, datum decoding, or map/list scans.
- Keep data in `ByteArray` form whenever possible; avoid unnecessary `Data` conversions.
- Avoid decoding full maps when only a few keys are needed; use focused lookups.
- Avoid repeated serialization/hashing in a single branch; compute once and reuse.
- Use compact deterministic encodings for proof payload values (e.g. compact flags bytes) to reduce redeemer/proof size.
- Keep trace output disabled in deploy artifacts (`aiken build --trace-level silent`).
- Avoid allocations that only support intermediate convenience types when branch logic can consume canonical transaction types directly.

`C-002` optimization currently implemented:
- `verify_policy_approval` performs cheap guard checks before MPF operations.
- policy flags use compact deterministic byte encoding for trie values.

Current measured baselines:
- `docs/spec/aiken-cost-baseline.md`

Current compiler workaround:
- Aiken `v1.1.21` now compiles validator forwarding to tx-aware dispatch:
  - `aiken/validators/personalization.ak` -> `update.dispatch_from_tx(...)`.
- Confirmed compiler-constraint baseline and repro probes are documented in:
  - `docs/spec/aiken-compiler-constraints.md`
  - `tests/aiken.compilerConstraints.test.js`
- Compiler-safe tx-aware integration is active for:
  - `RETURN_TO_SENDER`,
  - `MIGRATE`,
  - `REVOKE`,
  - `UPDATE`.
- Compiler-safe datum helper adapters are active for tx-aware paths:
  - `datum.get_datum_opt`,
  - `datum.map_get`,
  - `datum.int_or`,
  - `datum.has_value_unwrapped` (presence-only fallback under current compiler constraints).
- These tx-aware paths are covered by module tests in `aiken/lib/personalization/update.ak` and cost guards in `tests/aiken.cost.test.js`.
- PERSONALIZE library path is wired through `personalize_is_valid` (same module), including:
  - base gating + reset/non-reset authorization helpers,
  - policy datum approval checks using MPF-derived `AssetApprovalStatus`,
  - dedicated cost probes for non-reset/reset and dispatch-PERSONALIZE hot paths.
- Remaining blocked step is full tx-aware `PERSONALIZE` parity integration under the same compiler constraints.

## Migration and Rollout
1. Implement Aiken validator behind parallel build path.
2. Run parity suite until branch-complete.
3. Freeze ABI (datum/redeemer schema for PMF proofs).
4. Publish migration notes for off-chain callers.
5. Generate deployment artifacts and compare size/cost against Helios baseline.

## Risks and Mitigations
- Risk: ABI break due new proof fields.
  - Mitigation: versioned redeemer schema and migration guide.
- Risk: proof serialization mismatch between off-chain and Aiken.
  - Mitigation: golden vector tests for proof bytes and decoding.
- Risk: behavior drift in reset/subhandle edge cases.
  - Mitigation: branch parity matrix enforced in CI.
- Risk: increased tx size from proofs.
  - Mitigation: budget/perf tests with realistic proof sizes.

## Acceptance Criteria
- Aiken contract implements all five redeemer flows with documented parity.
- MPF-backed policy approval checks replace legacy map checks for BG/PFP policy IDs.
- All currently-covered behavioral branches remain covered by tests.
- Cost regression checks are tracked for critical paths and stay within agreed CPU/memory envelopes.
- Docs updated with final Aiken ABI and branch matrix.

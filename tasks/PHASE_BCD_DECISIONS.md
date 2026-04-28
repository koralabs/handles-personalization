# Phase B/C/D Decisions Log

Decisions made while you were AFK. Each entry: what I chose, why, and what to push back on if it's wrong.

## TL;DR — final state

Five commits on `feature/policy-override-mpt`, **not yet pushed** (push needs your nod):

1. `feat(deploy): emit signed tx-NN.cbor for settings updates` (Phase A.5)
2. `feat(pers): proxy + logic validator split with multi-contract deploy plan` (Phase B)
3. `feat(pers): atomic flip to pers@handle_settings namespace` (Phase C)
4. `feat(pers): cbor-splice multisig merger + drop helios from datum decoder` (Phase D narrow)
5. `chore(pers): remove helios + CSL from handles-personalization` (Phase D cleanup)

**Tests:** 51 pass, 0 fail. The aiken.cost.test.js stale-name issue is fixed in commit 5.

**Live planner is intentionally broken against preview/preprod/mainnet** — see decision C3 + the Phase C section in "Pre-existing issues observed during Phase B." It becomes runnable again at Phase E (live cutover).

---

## Phase B — proxy + logic split

### B1. Validator file naming
- `aiken/validators/pers_proxy.ak` — spend handler only.
- `aiken/validators/pers_logic.ak` — withdraw handler only.
- `aiken/validators/pers.ak` — **deleted**.

Validator names inside the files: `validator personalization_proxy { ... }` and `validator personalization_logic { ... }`. Plutus.json titles will become `pers_proxy.personalization_proxy.spend` and `pers_logic.personalization_logic.withdraw`.

### B2. Logic-credential registry
- **Use the existing `valid_contracts` field in `pz_settings`.** Do not add `pers_logic_cred`.
- `valid_contracts` is already a `List<ByteArray>` and already serves as the registry (the proxy spend handler walks it). DeMi uses a single `mint_governor` field; we have a list which is *more* flexible (multiple logic versions can coexist during cutover).
- `valid_contracts` populated with `[pers_logic_hash]` (or `[pers_logic_hash, pers_logic_v2_hash]` during a swap). The proxy's own hash should NOT be in `valid_contracts`.

### B3. Single-contract YAML schema is incompatible
The existing `deploy/<network>/personalization.yaml` schema assumes one validator file. After splitting, every consumer breaks. So Phase B necessarily absorbs the multi-contract YAML slice that I had previously bucketed into Phase D.

New schema (mirrors `decentralized-minting/deploy/<network>/decentralized-minting.yaml`):

```yaml
schema_version: 3
network: preview
contracts:
  - contract_slug: pers_proxy
    script_type: pers_proxy
    deployment_handle_slug: pers_proxy
    build:
      target: aiken/validators/pers_proxy.ak
      kind: validator
      parameters: {}
  - contract_slug: pers_logic
    script_type: pers_logic
    deployment_handle_slug: pers_logic
    build:
      target: aiken/validators/pers_logic.ak
      kind: validator
      parameters: {}
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
assigned_handles:
  settings: [...]
  scripts: [...]
ignored_settings: []
settings:
  ...
```

`schema_version` bumped from 2 → 3 to guard against running v3 plans through v2 tooling.

### B4. compileAiken.js artifact paths
The single `aiken.spend.hash` / `aiken.withdraw.hash` files become per-validator. New layout in `./contract/`:
- `aiken.<validator>.hash`
- `aiken.<validator>.addr_testnet`
- `aiken.<validator>.addr_mainnet`
- `aiken.<validator>.compiled.cbor` (the optimized UPLC)

The old aggregate files (`aiken.spend.hash`, `aiken.withdraw.hash`, `aiken.spend.addr_*`, `aiken.withdraw.stake_addr_*`) are removed.

`getAikenArtifactPaths(contractDirectory, validatorSlug)` becomes a function of the validator slug.

### B5. Helios-side compile.js + pers.helios
- Keep for now. They're decoupled from the new Aiken paths and the user told me explicitly "I didn't mean for you to do all of that Helios/CSL work now" — but also said "I only meant it for handles_personalization." I'm interpreting this as: don't aggressively rip out Helios mid-Phase-B (would mushroom scope), but do clean it up at the end of the Phase B/C/D push. Final cleanup pass is the last todo.

### B6. parityRunner
- The parity runner currently checks behavior parity between the Helios `pers.helios` and the Aiken `pers.ak`. After the split, parity has to consider both new validator files together as the equivalent of the Helios validator. Will adapt parityRunner to call both proxy+logic in sequence.

---

## Phase C — settings namespace migration

### C1. Settings handle renames
- `pz_settings` → `pers@handle_settings`
- `bg_policy_ids` → `pers_bg@handle_settings`
- `pfp_policy_ids` → `pers_pfp@handle_settings`

### C2. Phase C is a code-only change
The on-chain handles don't move (Phase E is the live cutover). Phase C just updates the off-chain code/yaml/tests/fetch URLs to point at the new names. The current names stay live until cutover.

### C3. Backward compat shim
For the BFF + on-chain validators, both names should be readable during the transition. **Decision: code does NOT support both.** The handles-personalization repo flips to the new names atomically. The BFF (in handle.me) flips at cutover. This is what "atomic cutover acceptable" from the user means.

---

## Phase D — deployment system catch-up

### D1. Multi-contract registry
Already absorbed into Phase B (B3, B4). Phase D adds the *deployment ordering* logic on top.

### D2. Two-phase SubHandle allocation
Mirror DeMi's two-phase pattern: phase 1 allocates the SubHandle (creates it at the deployer's address); phase 2 deploys the script and assigns the SubHandle to the script address. This decouples "buy a SubHandle" from "use it for a script reference."

### D3. Byte-splice CBOR multisig merger
For the settings tx (and any other multisig tx), signers each produce a vkey witness. Combining N witnesses without re-serializing the whole tx CBOR (which would mutate the body bytes and invalidate signatures) requires byte-splicing into the witness set. Port from `decentralized-minting/src/helpers/cardano-sdk/cborSplice.ts`.

---

## Pre-existing issues observed during Phase B

### tests/aiken.cost.test.js failures (pre-existing)
Three of the cost tests reference Aiken test names that no longer exist in the source (`verify_policy_approval_accepts_valid_bg_proof`, `approval_status_for_asset_accepts_precomputed_bg_and_pfp_proofs`, `policy_datum_is_valid_accepts_valid_flags_and_image_rules`). I confirmed by stashing my Phase B changes and re-running — the same three failures appear. Not a Phase B regression. Needs a separate bookkeeping pass on aiken.cost.test.js to align with the current Aiken test names.

### Phase C: planner can't run live until cutover
After Phase C the YAML/code references `pers@handle_settings` etc., but the live preview chain still has the old `pz_settings`/`bg_policy_ids`/`pfp_policy_ids` handles. Running `scripts/generateDeploymentPlan.js` against preview now fails with `failed to load handle pers@handle_settings: HTTP 404`. This is the *intended* atomic-flip state and documented in C3. The planner becomes runnable again once Phase E (live cutover) mints the new handles and moves the datums.

### `?type=<scripttype>` script lookup is 404 on preview
The `/scripts?latest=true&type=<oldScriptType>` query I used in `fetchLiveDeploymentState` returns 404 for known live contracts (e.g., `?type=pz` 404s even though `pers6@handlecontract` is live at `91c9830776b2169e0a4a3227a4fda22d10bf253e91b31eb4115964ff`). The handler in fetchLiveDeploymentState treats 404 as "never deployed under that slug" — so pers_proxy reports `current_script_hash: null`. Drift detection still works (both contracts correctly flagged as needing deployment), but the planner can't *replace* an old contract with a new one in the auto-allocate flow. To make this work at cutover time, we'll need a different lookup — probably scan `/scripts?latest=true` (returns all live scripts as an address-keyed map) and filter by validator hash or by the deployment-handle namespace. Bookmark for Phase E or the deployment-tooling pass.

## Open questions parked for you

1. **Existing Helios `pers.helios` file** — delete outright, or keep as historical reference until live cutover (Phase E)? Default: keep for now, delete in final cleanup pass.

2. **`scripts/build_pz_settings_cred_refresh.js`** — confirmed superseded by Phase A.5's `tx-NN.cbor` flow. Will delete in final cleanup pass.

3. **Old `pz_settings` data on-chain** — when we rename to `pers@handle_settings`, do we need an on-chain migration to move the settings UTxO from the old handle to the new one, or does the new handle just get minted fresh with the same datum? **Default: fresh mint at cutover (Phase E).**

4. **`pers_proxy` parameterization** — DeMi parameterizes the proxy with `mint_governor` (the logic hash) so the proxy doesn't have to read settings each spend. We could parameterize `pers_proxy` with the `valid_contracts` policy if we wanted, but that defeats the point of state-key registration (you'd have to redeploy proxy to change the registry). **Default: keep `pers_proxy` un-parameterized; it reads `valid_contracts` from settings each spend.**

# Phase B/C/D Decisions Log

Decisions made while you were AFK. Each entry: what I chose, why, and what to push back on if it's wrong.

## Phase E — live cutover sequence

Per network (preview → preprod → mainnet, staggered):

1. **Reserve the three new handles in the minting engine.** Run `node scripts/reserveSettingsHandles.js --network <net>`. The script inserts `cost: 0` / `paymentAddress: 'already_paid'` rows into `minting_engine_sessions[_<network>]` with `returnAddress = derivation 12` (the kora-team admin wallet, same address as `handlecontract` and `kora@handle_prices`). The engine cron picks up `Status.PAID` rows and mints the handles to derivation 12. Pre-flight check: skips any handle that already exists on-chain. Idempotent via `ConditionExpression: 'attribute_not_exists(pk)'`.

   Pattern verbatim from the deleted `adahandle-internal/minthandles-cli/minthandles.mjs` (commit `b02150e^`); the modern DynamoDB-driven engine still picks up these rows because `getPaidPendingSessions` filters by `status` only — no `paymentAddress` content check anywhere in the cron.

2. **Wait for the mints to land.** Poll `api.handle.me/handles/<name>` until 200 for each. Allow 60s of additional Blockfrost indexing time. The DeMi deployment-plan workflow pattern (60-second sleep after confirmation) is a good template.

3. **Run the datum-attach tx for each handle** (one tx per handle), using `settingsAttachTx.js`. Each tx:
   - Consumes the just-minted handle UTxO at derivation 12 (deployer wallet input).
   - Outputs the handle UTxO at the multisig native-script address (the existing `pz_settings` script address per network — addresses are in `docs/spec/assets/<network>-wallet-payment-native-script.json`) with the inline datum attached.
   - Signed by derivation 12's vkey only — derived from `POLICY_KEY` via `getPolicyWallet(12)` in `minting.handle.me/src/helpers/cardano/wallet.ts`.

   Datums per handle:
   - `pers@handle_settings`: copy of the live `pz_settings` 9-field datum (`cbor.decodeFirstSync` of `/handles/pz_settings/datum`, optionally apply any patches from the desired YAML, re-encode — same logic as `buildPatchedSettingsDatum.js`).
   - `pers_bg@handle_settings`: bare 32-byte ByteArray = the partners trie root for bg category. Copy verbatim from the existing `bg_policy_ids` UTxO datum.
   - `pers_pfp@handle_settings`: same as bg, but for pfp category. Copy from `pfp_policy_ids`.

4. **Verify on-chain.** Run `scripts/generateDeploymentPlan.js --desired deploy/<network>/personalization.yaml --artifacts-dir /tmp/...` — should now resolve the new handles, decode the migrated datum, and report `drift_type: no_change` for settings (script_hash drift remains until pers_proxy/pers_logic are deployed).

5. **Decommission the old handles** (separate, post-verification step, all-networks-confirmed). Once cutover is verified at all three networks, the old `pz_settings` / `bg_policy_ids` / `pfp_policy_ids` UTxOs can be spent (via the multisig) to consolidate ADA. No on-chain functional dependency on them after cutover.

**Permission boundary (NEVER cross):** the reservation script in step 1 is the *only* path for getting handles minted. It does not sign mint txs itself; it inserts a session row and lets the production minting engine do the actual mint. Per the never-mint rule (see `AGENTS.md` and `feedback_never_mint.md`), no agent may bypass `minting.handle.me` to mint a Kora handle — even for cutovers, even "just for preview".

## TL;DR — current state

Nine commits on `feature/policy-override-mpt`, **not yet pushed**:

1. `feat(deploy): emit signed tx-NN.cbor for settings updates` (Phase A.5)
2. `feat(pers): proxy + logic validator split with multi-contract deploy plan` (Phase B)
3. `feat(pers): atomic flip to pers@handle_settings namespace` (Phase C)
4. `feat(pers): cbor-splice multisig merger + drop helios from datum decoder` (Phase D narrow)
5. `chore(pers): remove helios + CSL from handles-personalization` (Phase D cleanup)
6. `docs(tasks): TL;DR for the Phase B/C/D push`
7. `docs(tasks): resolve open questions from the Phase B/C/D push` (restored pers.helios)
8. `docs(tasks): clarify Q4 — non-strict proxy is the upgradeable one`
9. `feat(deploy): add settingsAttachTx for Phase E datum-attach flow`

**Tests:** 54 pass, 0 fail.

**Live planner is intentionally broken against preview/preprod/mainnet** until Phase E cutover. See above.

**Branching:** match decentralized-minting — single `master`, per-network workflow dispatch via GitHub `environment`s. handles-personalization does NOT need preview/preprod/mainnet branches.

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

## Resolved questions (your answers)

1. **`pers.helios`** — *Keep until mainnet cutover successful.* I had deleted it in commit 5; restored in a follow-up commit. The file is back in the repo at the root. Once mainnet cutover lands, it goes for good. (Tooling around it — `compile.js`, parity tests — stays deleted; we can `git checkout 65c3643~ -- compile.js` if we ever need to recompile to verify hash parity.)

2. **`scripts/build_pz_settings_cred_refresh.js`** — *OK to delete.* Already deleted in commit 5.

3. **Phase E datum-attachment workflow** — *Minting happens in the minting engine which knows nothing of datum. Datum always has to be attached after mint.*

   So the Phase E sequence per network is:

   1. Mint `pers@handle_settings`, `pers_bg@handle_settings`, `pers_pfp@handle_settings` to the deployer wallet via the standard minting engine (no datum).
   2. Build a settings-attach tx (separate from the standard mint) that:
       - Spends the just-minted handle UTxO
       - Outputs the same handle UTxO at the multisig native-script address with the inline datum attached
       - Native-script witness from the multisig signers
   3. (For `pers@handle_settings` only — `pers_bg`/`pers_pfp` carry root-hash datums that are populated by the partners-trie seeding flow.) Sanity-check: re-run `scripts/generateDeploymentPlan.js` — should report `no_change` for settings.

   Implementation note: this is essentially the same shape as `settingsUpdateTx.js` but with a different input (a plain wallet UTxO holding the handle, no existing datum) and a different output address (multisig script, not the wallet). Plan to extend or fork `settingsUpdateTx.js` for the cutover tx — bookmarked for Phase E.

4. **`pers_proxy` parameterization** — **Decision: non-strict (state-key registration via `pz_settings.valid_contracts`).** This is what's committed.

   The naming was misleading — "DeMi-strict" sounds like the *more upgradeable* option but it's the opposite. Two patterns:

   - **Non-strict (current)**: `pers_proxy.ak` takes no parameters. Its script hash is fixed. At spend time it reads `pz_settings` from a reference input and checks a withdraw_0 came from any cred in `valid_contracts`. To swap logic: update `valid_contracts` via a settings tx (multisig-signed). **Existing tokens at the proxy auto-pick up the new logic on their next spend** — no migration, no re-locking.

   - **DeMi-strict (rejected)**: parameterize `pers_proxy(logic_credential)`. Script hash becomes a function of the parameter, so each logic change = new proxy address. Existing ref NFTs stay at the OLD proxy bound to the OLD logic forever (or until per-handle migration). New mints go to the NEW proxy. DeMi tolerates this because each minting epoch is independent; personalization can't, since a single handle's reference NFT is meant to be re-personalizable across years.

   So the non-strict version is the "true upgradeable proxy" for personalization's lifecycle. The DeMi-strict version is a versioned fork pattern that happens to be called "proxy". Confusing terminology — the takeaway is: **un-parameterized + state-key registration in settings = the right call here.**

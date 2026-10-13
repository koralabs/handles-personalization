# handles-personalization canonical contract

**Status: proposal (ecosystem-ownership-plan row 5.2). Operator review pending.**

These contracts hold every handle's 100 reference token and decide how its datum may change. Protected production source is listed in [`.enclave`](./.enclave);
other enforcement references below are not automatically enclave paths.

## Review scope and unchanged authority

Decision 2 clarification (2026-10-13): the human-review enclave is actual Aiken/Helios
on-chain source, listed as exact files in [`.enclave`](./.enclave), plus this contract
and the manifest's self-protection. Test-only sources, npm/package files, JS/TS,
builders, configuration, generated artifacts and workflows follow ordinary automated
tests and independent agent review; their location in a contract repository alone
never requires human approval. Existing unrelated holds remain in force.

Separately identifiable embedded Aiken `test` blocks and test-only helpers are testing
code, not protected on-chain behavior. Test-only edits to those blocks follow ordinary
agent review. Mixed files remain listed for their production definitions: the current
path-only merge gate cannot distinguish such hunks and may still request approval.
This is an enforcement limitation, not expanded human-review policy; no source was
split or changed in this documentation-only proposal.

This narrows code-review scope only. Actual on-chain validator or settings changes
(settings handles, policy roots, `pers*@handle_settings` and handlecontract datums),
anything that could double-mint, and automated burns or other irreversible on-chain
actions retain explicit operator authorization. Routine builder/package/test repairs
are not such actions merely because of their repository or filename. K.O.R.A. may
sign for preview only within existing authorization; preprod and mainnet always need
humans on the multisig. No signing, secret access or spending is authorized here.
Independent review pending; this proposal is not accepted and must not be merged.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root), "Critical Correctness": handle addresses correct 100% of
  the time, never double-mint, properties chain-accurate. "Merging": any edit to an on-chain
  contract/validator or to contract settings (settings handles, policy roots, `pers*@handle_settings`
  datums, handlecontract datums), anything that could double-mint, and any automated burn is
  higher-risk and needs operator approval before merge.
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2: for contract repos the enclave holds
  Aiken/Helios on-chain source, excluding testing and npm/package code; K.O.R.A. may sign for preview only,
  preprod and mainnet always need humans on the multisig. Phase 5 row 5.2.
- kora-bot `v3/docs/tool-surface.md` (`merge_pr`): cards enclave paths merged into
  `master`/`main`/`mainnet`/`preprod`, reading a root `.enclave`.
- This repo: `AGENTS.md` "DO NOT MINT HANDLES — EVER" (minting.handle.me is the only mint path);
  decentralized-minting `docs/spec/contract-protections.md` (per-validator protections for
  `persprx`, `perspz`, `perslfc`, `persdsg`).

## Must never be violated

1. **Never mint handles from this repo.** No tool here builds a tx that mints under a handle policy.
2. **The `persprx` hash is frozen.** It validates nothing itself; it only requires a zero-ada
   withdrawal from an observer listed in `pz_settings.valid_contracts` with the exact
   `Constr 0 [own_ref, spend_redeemer]` envelope. Changing it means a chain-wide 100 migration.
3. **Reference datums stay chain-accurate.** Immutable fields never change; pfp/bg must be
   policy-approved (MPF proof) and match the asset's own datum image; `nsfw` follows the approvals.
4. **Public virtual sub-handle leases are inviolable.** No admin, root or proof shortens one.
5. **`pers*@handle_settings` datums and policy roots change only by a reviewed settings tx.**
   K.O.R.A. may sign preview only; preprod and mainnet always need humans on the multisig.

## Where it is enforced today

| # | Code |
|---|---|
| 1 | `AGENTS.md` (prose), `helpers/contractHandleGuard.js` |
| 2 | `aiken/validators/persprx.ak`, `aiken/lib/personalization/proxy_check.ak`, `scripts/check-persprx-hash-stable.js` |
| 3 | `aiken/validators/perspz.ak`, `persdsg.ak`, `lib/personalization/personalize_*.ak`, `policy_index_mpf.ak` |
| 4 | `aiken/validators/perslfc.ak`, `lib/personalization/revoke.ak`, `update.ak` |
| 5 | `deploy/<network>/personalization.yaml`, `settingsUpdateTx.js`, `buildPatchedSettingsDatum.js` |

## Refactor needed for enforcement

- **Rule 1 is prose only.** No test fails if a script here adds a mint field for a handle policy;
  `helpers/cardano-sdk/signTx.js` should refuse it, with a test.
- **`scripts/` holds many one-off cutover/sign scripts** (run by hand, not enclaved). Finished
  cutovers should be retired so the unenclaved signing surface shrinks.
- **Rule 5 is prose only** (plan row 4.7).

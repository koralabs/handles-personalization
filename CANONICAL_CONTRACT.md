# handles-personalization canonical contract

## Purpose and authority

I am the on-chain personalization contract family for handles: `persprx` (frozen proxy), `perspz` (personalization), `perslfc` (lifecycle: revoke, update, sub-handle leases) and `persdsg` (designer settings), plus the legacy `pers.helios`. I also hold the settings tooling that updates their datums. Protected files are in [`.enclave`](./.enclave).

## Invariants that must never be violated

1. I never mint handles. No tool here builds a transaction that mints under a handle policy; minting.handle.me is the only mint path. Prose only (`AGENTS.md`); no test fails if a script adds a handle mint.
2. The `persprx` hash is frozen. It validates nothing itself and only requires a zero-ada withdrawal from an observer in `pz_settings.valid_contracts` with the exact `Constr 0 [own_ref, spend_redeemer]` envelope. Enforced by `scripts/check-persprx-hash-stable.js` (run by hand, not in a test or workflow).
3. Reference datums stay chain-accurate. Immutable fields never change; pfp and background must be policy-approved by an MPF proof and match the asset's own datum image; `nsfw` follows the approvals. Covered by the Aiken tests under `aiken/test` and `tests/aiken.intentCoverage.test.js`.
4. A public virtual sub-handle lease can never be shortened by an admin, a root or a proof (`perslfc`, `revoke.ak`, `update.ak`). Covered where `aiken.intentCoverage.test.js` lists it; confirm per release.
5. A contract handle is never reused for new script bytes while handles are locked under its current script and no other `@handlecontract` handle carries it. Enforced by `helpers/contractHandleGuard.js` and `tests/contractHandleGuard.test.js` (the 281-handle persprx1 incident, 2026-09-10).
6. Settings datums and policy roots change only through a reviewed settings transaction (`settingsUpdateTx.js`, `buildPatchedSettingsDatum.js`), with humans on the multisig for preprod and mainnet. Builders are tested; the signer rule is prose only.

## Boundaries and known limits

`scripts/` holds many one-off cutover and signing scripts, run by hand and not protected. `helpers/cardano-sdk/signTx.js` does not refuse a handle-policy mint.

## Refactors needed to enforce this

- Make `signTx.js` refuse any mint under a handle policy, with a test.
- Run the persprx hash check as a test.
- Retire finished cutover scripts to shrink the unprotected signing surface.
- Make the deploy plan refuse non-preview agent signatures (plan row 4.7).
## Authority and limits that apply to everything here

- Higher-risk and operator-approved only: any edit to an on-chain validator or to settings (settings handles, policy roots, `pers*@handle_settings` and handlecontract datums), anything that could double-mint, and any automated burn.
- I may sign for preview only. Preprod and mainnet always need humans on the multisig. Nothing in this repo authorises secret access, signing or spending by an agent.
- The `.enclave` lists only the on-chain source and these two files. It is path-only: a test-only change inside a listed file still asks for approval.

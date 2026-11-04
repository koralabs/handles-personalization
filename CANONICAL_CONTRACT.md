# handles-personalization canonical contract

I am the on-chain personalization contract family for handles: `persprx` (frozen proxy), `perspz` (personalization), `perslfc` (lifecycle: revoke, update, sub-handle leases) and `persdsg` (designer settings), plus the legacy `pers.helios` and the tooling that updates their settings datums.

1. **I never mint handles.** No tool here builds a transaction that mints under a handle policy; minting.handle.me is the only mint path.
2. **The `persprx` hash is frozen.** It validates nothing itself and only requires a zero-ada withdrawal from an observer in `pz_settings.valid_contracts` with the exact `Constr 0 [own_ref, spend_redeemer]` envelope.
3. **Reference datums stay chain-accurate.** Immutable fields never change; pfp and background must be policy-approved by an MPF proof and match the asset's own datum image; `nsfw` follows the approvals.
4. **A public virtual sub-handle lease can never be shortened** by an admin, a root or a proof (`perslfc`).
5. **A contract handle is never reused for new script bytes** while handles are locked under its current script and no other `@handlecontract` handle carries it (`helpers/contractHandleGuard.js`).
6. **Settings datums and policy roots change only through a settings transaction** built by `settingsUpdateTx.js` / `buildPatchedSettingsDatum.js`.

# Feature Matrix

| Area | Capability | Assurance | Primary Files |
| --- | --- | --- | --- |
| Personalize | Handle metadata personalization | CID integrity, default enforcement, fee policy, asset consistency, immutable guardrails | `pers.helios`, `tests/tests.js`, `tests/txTests.ts` |
| Subhandle Personalize | NFT/Virtual subhandle personalization | Root linkage, root settings, `pz_enabled`, root-share fee split | `pers.helios`, `tests/txTests.ts` |
| Reset | Controlled reset of personalization fields | Authorization checks + private info reset rules | `pers.helios`, `tests/tests.js` |
| Migrate | Script migration path | Datum equality, valid contract allowlist, signer policy | `pers.helios`, `tests/tests.js` |
| Revoke | Virtual subhandle revoke | Public/expiry and private/root-signed revocation constraints | `pers.helios`, `tests/txTests.ts` |
| Update | Virtual subhandle update | Restricted mutability, settings token checks, payment + signature gating | `pers.helios`, `tests/txTests.ts` |
| Return to Sender | Admin recovery path | Rejects Handle ref/root-setting token returns | `pers.helios`, `tests/tests.js` |
| Observer upgrade gate (Aiken) | `withdraw 0` observer-gated spend validation | Spend requires matching observer withdrawal witness; observer redeemer must match spend `own_ref` + redeemer | `aiken/validators/pers.ak`, `aiken/lib/personalization/update.ak`, `tests/compileAiken.test.js` |
| Compile pipeline | Contract artifact generation | Deterministic outputs for deploy/review | `compile.js`, `compileHelpers.js`, `tests/compile.test.js` |
| Message coverage guard | Branch-level assertion message coverage | Every reachable assert/error message mapped to tests | `tests/contract.messages.test.js` |

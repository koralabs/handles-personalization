# Feature Matrix

| Area | Capability | Assurance | Primary Files |
| --- | --- | --- | --- |
| Personalize | Handle metadata personalization | CID integrity, default enforcement, fee policy, asset consistency, immutable guardrails | `contract.helios`, `tests/tests.js`, `tests/txTests.ts` |
| Subhandle Personalize | NFT/Virtual subhandle personalization | Root linkage, root settings, `pz_enabled`, root-share fee split | `contract.helios`, `tests/txTests.ts` |
| Reset | Controlled reset of personalization fields | Authorization checks + private info reset rules | `contract.helios`, `tests/tests.js` |
| Migrate | Script migration path | Datum equality, valid contract allowlist, signer policy | `contract.helios`, `tests/tests.js` |
| Revoke | Virtual subhandle revoke | Public/expiry and private/root-signed revocation constraints | `contract.helios`, `tests/txTests.ts` |
| Update | Virtual subhandle update | Restricted mutability, settings token checks, payment + signature gating | `contract.helios`, `tests/txTests.ts` |
| Return to Sender | Admin recovery path | Rejects Handle ref/root-setting token returns | `contract.helios`, `tests/tests.js` |
| Compile pipeline | Contract artifact generation | Deterministic outputs for deploy/review | `compile.js`, `compileHelpers.js`, `tests/compile.test.js` |
| Message coverage guard | Branch-level assertion message coverage | Every reachable assert/error message mapped to tests | `tests/contract.messages.test.js` |

# Feature Matrix

| Area | Capability | Module |
| --- | --- | --- |
| Contract source | Personalization validator logic | `contract.helios` |
| Compile pipeline | Build and persist contract artifacts | `compile.js`, `compileHelpers.js` |
| Scenario fixtures | Build datum/redeemer/context fixtures | `tests/fixtures.ts`, `tests/testClasses.js` |
| Legacy contract scenarios | Run approve/deny behavior checks | `tests/tests.js`, `tests/contractTesting.js` |
| Tx-focused tests | Transaction-level personalization checks | `tests/txTests.ts` |
| Coverage guardrail | Compile-path line/branch threshold enforcement | `test_coverage.sh` |

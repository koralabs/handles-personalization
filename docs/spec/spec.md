# Technical Spec

## Architecture

### Core Files
- Validator source: `contract.helios`
- Compile entrypoint: `compile.js`
- Compile helpers: `compileHelpers.js`
- Legacy test harness:
  - `tests/contractTesting.js`
  - `tests/testClasses.js`
  - `tests/tests.js`
- Tx-focused tests: `tests/txTests.ts`

### Compile Entry Behavior
- Reads validator source from disk.
- Resolves optimizer flag via helper.
- Compiles validator and computes script address.
- Writes serialized artifacts to `./contract/*`.

## Test Surfaces

### Scenario Harness
- Uses fixture classes and scripted contexts to evaluate approve/deny outcomes.
- Supports grouped runs and optional profiling path in harness utilities.

### Coverage Harness
- `test_coverage.sh` runs compile-path tests with Node test coverage.
- Enforces:
  - lines >= 90%,
  - branches >= 90%.
- Writes report output to `test_coverage.report`.

## Known Test Runtime Constraint
- Repository `npm test` currently fails in this environment on `tests/tests.js` because `@koralabs/kora-labs-contract-testing` import resolution cannot find `colors` under Node 22 ESM resolution.
- Guardrail compile-path coverage tests remain executable and passing.

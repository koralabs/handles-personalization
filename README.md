# handles-personalization

## Documentation
- [Docs Index](./docs/index.md)
- [Product Docs](./docs/product/index.md)
- [Spec Docs](./docs/spec/index.md)

## Local Validation
- `npm test` (scenario harness; may require stable external runtime dependencies)
- `node --test tests/compile.test.js`
- `npm run test:aiken` (Aiken compile + MPF/dispatch/PERSONALIZE-helper cost guards + off-chain proof adapter vectors)
- `npm run test:parity` (dual-run Helios vs Aiken mapped-branch parity report at `tests/reports/parity-report.{json,md}`)
- `node --test tests/contract.messages.test.js`
- `./test_coverage.sh`

## Compiling Plutus Script
- Helios only: `npm run compile:helios`
- Aiken blueprint export: `npm run compile:aiken`
- Both: `npm run compile:all`

`npm run compile:aiken` now writes deterministic deployment artifacts under `contract/`:
- `aiken.plutus.json`
- `aiken.validators.json`
- `aiken.addresses.json`
- `aiken.spend.hash`
- `aiken.spend.addr_testnet`
- `aiken.spend.addr_mainnet`


## Submitting on-chain

## Testing
```sh
npm install
cd tests
node tests.js
```

## Compile for mainnet
```
OPTIMIZE=true REMOVE_ERRORS=true node compile.js
```

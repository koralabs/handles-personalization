# Runtime Flows

## Compile Flow
1. Load `contract.helios`.
2. Resolve optimize toggle from environment (`OPTIMIZE`).
3. Compile validator with Helios.
4. Generate address and write all artifact files to `./contract`.

## Personalization Scenario Flow
1. Build fixture context/datum/redeemer objects from test classes/fixtures.
2. Compile contract (optimized or unoptimized per test case).
3. Run contract assertions via test harness utilities.
4. Record pass/fail and summary counts.

## Migration/Reset Flow
- Scenario test classes define dedicated redeemers and context setup for:
  - migrate path,
  - reset path,
  - return-to-sender path.
- Contract assertions validate expected approve/deny outcomes per scenario.

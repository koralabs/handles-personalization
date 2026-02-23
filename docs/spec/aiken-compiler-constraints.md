# Aiken Compiler Constraints (BX-001)

## Scope
This document records reproducible compiler constraints observed in this repo with:
- `aiken v1.1.21+42babe5`

These constraints are implementation rules for ongoing migration tasks, especially `B-003` and `D-002`.

## Reproduction Summary

Observed on 2026-02-23:
- A probe that projects `Option<Data>` to `Int` compiles and runs tests successfully.
- A probe that unwraps `Option<Data>` with fallback and returns `Data` fails compilation with:
  - non-zero exit status
  - no diagnostics (`error:` not emitted)
  - compile output stops before test collection.

Automated repro:
- `tests/aiken.compilerConstraints.test.js`

The repro test is toolchain-aware:
- enforced for `v1.1.21`
- auto-skipped for other Aiken versions.

## Compiler-Safe Rules

### Allowed
- `Option<Data>` handling that returns non-`Data` types (`Bool`, `Int`, etc.).
- Carrying `Option<Data>` through call sites and pattern-matching where needed.
- Parsing typed values from `Data` only at the final use site.

### Forbidden (for v1.1.21 in this repo)
- Helpers that branch on `Option<...>` and return `Data` (or structures containing `Data`) when those helpers are exercised by tests/code paths.
- Re-introducing centralized fallback-style helpers shaped like:
  - `Option<Data> -> Data`
  - `Option<Data> -> Pair<Bool, Data>`

## Practical Workaround Strategy
- Keep datum access surfaces in `Option<Data>` form.
- Push fallback decisions to call sites as typed checks (`Bool`, `Int`) instead of materialized fallback `Data`.
- Favor small helper outputs that are directly consumed by branch gates to minimize both compiler risk and script costs.

Current compiler-safe helper surface (used in `aiken/lib/personalization/update.ak`):
- `datum.get_datum_opt(output_datum, tx) -> Option<Data>`
- `datum.map_get(map, key) -> Option<Data>`
- `datum.int_or(option_data, fallback) -> Int`
- `datum.has_value_unwrapped(option_data) -> Bool` (presence-only fallback for now)

Test note:
- Direct Aiken tests that construct/assert `Option<Data>` values in this toolchain can trigger the same silent-exit path.
- Helper behavior is therefore validated indirectly through tx-aware branch tests in `aiken/lib/personalization/update.ak` plus compiler probe coverage in `tests/aiken.compilerConstraints.test.js`.

## Migration Impact
- `BX-002` implements compiler-safe equivalents for blocked helper intent without forbidden signatures.
- `B-003` then restores branch parity coverage on top of those constraints.

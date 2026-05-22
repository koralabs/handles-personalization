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
- `datum.has_value_unwrapped(option_data) -> Bool` (int/non-empty-bytes gate via serialized-data prefix checks)

Test note:
- Direct Aiken tests that construct/assert `Option<Data>` values in this toolchain can trigger the same silent-exit path.
- Helper behavior is therefore validated indirectly through tx-aware branch tests in `aiken/lib/personalization/update.ak` plus compiler probe coverage in `tests/aiken.compilerConstraints.test.js`.

## Migration Impact
- `BX-002` implements compiler-safe equivalents for blocked helper intent without forbidden signatures.
- `B-003` then restores branch parity coverage on top of those constraints.

## BX-003 — Trace-strip Regression in Verbose Builds (observed 2026-05-22)

### Observed behaviour

In current master (post-`5789b0f` "perf(persdsg): cut designer_settings_are_valid mem ~57%"),
`aiken build --trace-level silent` and `aiken build --trace-level verbose --trace-filter all`
produce **identical bytecode** for all four personalization validators
(persprx, perspz, perslfc, persdsg). Same hash, same byte count, no trace
strings preserved in either output.

Reproduction:
```bash
cd aiken
aiken build --trace-level silent
python3 -c "import json,hashlib; d=json.load(open('plutus.json')); v=[x for x in d['validators'] if x['title']=='persdsg.persdsg.withdraw'][0]; print('silent ', hashlib.blake2b(b'\x03'+bytes.fromhex(v['compiledCode']),digest_size=28).hexdigest(), len(v['compiledCode'])//2, 'bytes')"
aiken build --trace-level verbose --trace-filter all
python3 -c "import json,hashlib; d=json.load(open('plutus.json')); v=[x for x in d['validators'] if x['title']=='persdsg.persdsg.withdraw'][0]; print('verbose', hashlib.blake2b(b'\x03'+bytes.fromhex(v['compiledCode']),digest_size=28).hexdigest(), len(v['compiledCode'])//2, 'bytes')"
```
Both produce identical output for current source on `v1.1.21+5538a42`.

### Prior state (worked)

Commit `a96a43e` ("deploy: publish unoptimized cbor for V3 split", ~2026-04-30)
committed `deploy/<network>/<slug>.unoptimized.cbor` files containing visible
ASCII trace strings, e.g.:
```
expect i: Int = z
expect zoom: Int = d
expect blur: Int = blur_data
expect cip68: types.PersonalizationDatum = d
expect new_datum: types.PersonalizationDatum = new_datum_data
observer_redeemer: types.ObserverRedeemer
```
persdsg.unoptimized.cbor at `a96a43e` was 7866 bytes; current verbose build
is 5649 bytes. Trace strings present then, absent now.

### Why this matters

handle.me/bff implements an observer-hash hot-swap diagnostic
(`lib/cardano/evaluateWithTrace.ts` + the reference implementation in
`bff/tmp/trace-multi-swap.ts`) that swaps deployed (silent-build) script bytes
for verbose-build bytes in scalus's local UTxO map, rewrites the tx body's
withdrawal credentials + pz_settings.valid_contracts to use the new hash, then
re-runs scalus to extract trace messages from the error. This produces
human-friendly error text in the frontend when a personalize fails.

With current source, this mechanism has nothing to swap to — the verbose
variant has identical bytecode (and hash) as deployed, with no trace strings
to surface. Chain rejections and BFF pre-eval both report `logs: []`.
End users see "Error evaluated" with no diagnostic.

### Restoration strategy

The compiler-generated traces from `expect` patterns are being optimized away
(likely by the recent perf rewrites, which restructure expect patterns into
forms the optimizer recognizes as eliminable). User-defined traces via
`trace @"..."` survive optimizer passes more reliably.

Add explicit `trace @"..."` statements before load-bearing `expect` calls and
boolean gates in the persprx/perspz/perslfc/persdsg paths. Each trace should
identify the validator + check being attempted, e.g.:

```aiken
trace @"persdsg: parse old_datum as PersonalizationDatum"
expect old_datum: types.PersonalizationDatum = old_datum_data
```

or tag boolean conjunctions with `?` to identify which branch returned False:

```aiken
multihash_matches(designer, hash_data)? &&
list.all(defaults, defaults_entry_valid)? &&
list.all(designer, designer_entry_valid)? &&
text_ribbon_colors_valid(defaults, designer, forced)?
```

After source updates, rebuild verbose → produces different hash with trace
strings → republish `deploy/<network>/*.unoptimized.cbor` → api.handle.me
serves new bytes → BFF swap mechanism becomes useful again.

### Verification

After restoration, the verbose-build hashes MUST differ from deployed:
```bash
aiken build --trace-level silent && silent_hash=$(...)
aiken build --trace-level verbose && verbose_hash=$(...)
test "$silent_hash" != "$verbose_hash"  # required
```
And the verbose cbor must contain visible trace text:
```bash
xxd deploy/preview/persdsg.unoptimized.cbor | grep -E 'persdsg:|expect '
```

### Related

- BFF hot-swap: `handle.me/bff/lib/cardano/evaluateWithTrace.ts`
- Reference standalone implementation: `handle.me/bff/tmp/trace-multi-swap.ts`
- API fetch path: `api.handle.me/services/scripts.service.ts`
  `fetchUnoptimizedCbor` GETs `raw.githubusercontent.com/koralabs/handles-personalization/master/deploy/<network>/<slug>.unoptimized.cbor`

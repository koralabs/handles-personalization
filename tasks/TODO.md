# Handles Personalization Aiken Migration Queue (Unattended)

Source docs:
- `docs/spec/aiken-conversion-spec.md`
- `docs/spec/aiken-conversion-task-list.md`
- `docs/spec/aiken-cost-baseline.md`
- `docs/spec/branch-coverage.md`
- `tasks/UNATTENDED_PROMPT.md`

Generated: 2026-02-23

This queue contains all remaining work to fully replace Helios with Aiken while preserving contract intent and branch-level assurances.

## Global completion rule (per non-doc task)

- Implement minimal production code (KISS/YAGNI).
- Add or update unit tests.
- Add or update e2e/integration tests when behavior crosses runtime boundaries.
- Run targeted tests first, then broader/full suites when appropriate.
- Update affected docs/spec/README/site.env in the same task.
- Preserve contract parity and optimize execution units (CPU/mem) where code paths are touched.

## Scope Coverage Map

| Scope item | Covered by tasks |
| --- | --- |
| Compiler blocker mitigation for datum helper semantics (`Option<Data>` / map lookup crash path) | BX-001, BX-002, B-003 |
| MPF-backed policy approval integration in PERSONALIZE validator flow | C-003, DX-001, D-002 |
| Remaining redeemer parity completion (`MIGRATE`, `REVOKE`, `UPDATE`, `RETURN_TO_SENDER`) | D-003, D-004, D-005, D-006 |
| Dual-run Helios vs Aiken parity harness + legacy scenario vectors | E-001, E-002 |
| Branch intent and message-coverage assurance rebuild | E-003, E-004 |
| Cost baseline completion and CI budget guard enforcement | F-001, F-004 |
| Deployment artifact/address generation and migration playbook | F-002, F-003 |

## Gap Coverage Map

| Gap source | Covered by tasks |
| --- | --- |
| `docs/spec/gaps.md` is not present in this repo as of 2026-02-23. Open scope is tracked from `docs/spec/aiken-conversion-task-list.md`. | BX-001, BX-002, B-003, C-003, DX-001, D-002, D-003, D-004, D-005, D-006, E-001, E-002, E-003, E-004, F-001, F-004, F-002, F-003 |

## Blocker Resolution Map

| Prior blocker | Workable unblock tasks |
| --- | --- |
| B-003: compiler silent-exit while implementing `get_datum` / `has_value_unwrapped` helper signatures | BX-001, BX-002 |
| D-002: compiler silent-exit while expanding tx-aware PERSONALIZE integration | BX-001, DX-001 |

## Ordered Backlog

- [x] BX-001 Reproduce and isolate Aiken compiler silent-exit patterns in this codebase, define allowed/forbidden coding patterns, and document the compiler-safe implementation constraints. (Depends: none)
- [x] BX-002 Implement compiler-safe equivalents for blocked datum-helper semantics (`get_datum`, `has_value_unwrapped`) and refactor call sites while preserving current intent/tests. (Depends: BX-001)
- [ ] B-003 Complete datum parsing helper parity (`get_extra`, `get_datum`, `has_value_unwrapped`, asset parsing) with malformed/empty/expected-shape coverage. (Depends: BX-002)
- [ ] C-003 Complete replacement of map-based approver logic in PERSONALIZE with MPF proof-backed BG/PFP approval and flags in validator-connected flow. (Depends: B-003)
- [ ] DX-001 Implement compiler-safe decomposition for tx-aware PERSONALIZE context parsing/wiring in small modules that compile under current toolchain constraints. (Depends: C-003)
- [ ] D-002 Integrate MPF into PERSONALIZE end-to-end and restore full parity scenarios for BG/PFP proof combinations. (Depends: DX-001)
- [ ] D-003 Complete MIGRATE parity scenario mapping and close remaining intent-matrix gaps for signer/ownership branches. (Depends: B-004)
- [ ] D-004 Complete REVOKE parity scenario mapping and close remaining intent-matrix gaps for privacy/expiry/type branches. (Depends: B-004)
- [ ] D-005 Complete UPDATE payment-path parity expansion and close remaining intent-matrix gaps for restricted/signer/settings-token branches. (Depends: B-004)
- [ ] D-006 Complete RETURN_TO_SENDER parity scenario mapping and close remaining intent-matrix gaps for admin/forbidden-token branches. (Depends: B-004)
- [ ] E-001 Build dual-run parity runner executing equivalent fixtures against Helios and Aiken validators with CI-report output. (Depends: D-002, D-003, D-004, D-005, D-006)
- [ ] E-002 Port legacy scenario vectors from `tests/tests.js` and stable subset of `tests/txTests.ts` into the parity runner. (Depends: E-001)
- [ ] E-003 Rebuild `docs/spec/branch-coverage.md` mapping for Aiken with no missing reachable branch intents. (Depends: E-002)
- [ ] E-004 Re-establish contract message-coverage guard for Aiken error intents under covered-or-unreachable rule. (Depends: E-002)
- [ ] F-001 Complete cost benchmarking with full validator-level PERSONALIZE + MPF paths and publish updated CPU/mem baselines. (Depends: D-002)
- [ ] F-004 Extend CI cost guard thresholds to include full PERSONALIZE validator branch ceilings and fail on regressions. (Depends: F-001)
- [ ] F-002 Complete deterministic Aiken artifact and address generation for deployment workflows. (Depends: D-002, D-003, D-004, D-005, D-006)
- [ ] F-003 Produce operational migration playbook covering ABI changes, datum/redeemer rollout, proof-service rollout, and rollback checklist. (Depends: E-003, F-002)

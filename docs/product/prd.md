# Handles Personalization PRD

## Summary
`handles-personalization` contains the personalization smart-contract source, compile tooling, and test harnesses used for CIP-68 handle profile updates (designer settings, asset-driven defaults, and migration/reset flows).

## Problem
Handle owners need on-chain personalization updates that:
- preserve ownership and policy validation rules,
- support background/PFP/designer default enforcement,
- support migration/reset and return-to-sender paths,
- keep generated contract artifacts reproducible for deployment.

## Users
- Contract engineers maintaining personalization validators.
- Operators compiling and deploying validator artifacts.
- QA/devs running personalization contract scenarios.

## Goals
- Keep personalization validator logic deterministic and testable.
- Provide a reproducible compile pipeline to artifact files under `./contract`.
- Maintain scenario-driven tests for personalization, migration, and reset behavior.
- Keep a lightweight repository-level coverage guardrail for compile tooling.

## Non-Goals
- Frontend personalization UX.
- Off-chain API/server runtime.
- Generic minting or marketplace behavior outside personalization contract scope.

## Functional Requirements

### Contract and Compile Tooling
- Compile `contract.helios` with optional optimizer toggle (`OPTIMIZE`).
- Emit compile artifacts:
  - `contract.json`,
  - `contract.hex`,
  - `contract.cbor`,
  - `contract.addr`,
  - `contract.hash`,
  - `contract.uplc`.

### Test and Scenario Coverage
- Support legacy scenario harness (`tests/tests.js`) for personalization rules.
- Support transaction-focused tests (`tests/txTests.ts`).
- Provide repository guardrail script (`test_coverage.sh`) and report (`test_coverage.report`).

## Success Criteria
- Compile artifacts are produced consistently from `compile.js`.
- Coverage guardrail reports >=90% lines/branches.
- Product/spec docs remain linked in README and docs index.

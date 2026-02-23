# Handles Personalization PRD

## Product Summary
`handles-personalization` is the on-chain validation layer for Handle personalization lifecycle actions. It enforces personalization safety rules for CIP-68 metadata while supporting migration, reset, virtual subhandle revoke/update, and controlled return-to-sender recovery.

## Problem Statement
Handle metadata updates must allow rich personalization while preserving:
- metadata immutability guarantees,
- provider/payment policy enforcement,
- virtual subhandle ownership and expiry constraints,
- protocol/admin safety controls.

Without strict on-chain checks, personalization could corrupt metadata, bypass fee policy, or alter ownership-sensitive data.

## Personas
- Protocol engineers maintaining validator logic and fixture tests.
- QA engineers validating regression safety of every branch-level rule.
- Operations/deployment engineers generating and verifying script artifacts.

## Product Goals
- Enforce deterministic, branch-explicit validation for `PERSONALIZE`, `MIGRATE`, `REVOKE`, `UPDATE`, and `RETURN_TO_SENDER` redeemers.
- Preserve immutable NFT/CIP-68 fields across all mutable flows.
- Gate sensitive actions by signer, token, and payment constraints.
- Keep behavior fully traceable from contract branch to scenario test.

## Non-Goals
- Frontend personalization UX.
- Off-chain API design.
- Generic marketplace or minting features beyond this validator scope.

## Core Features and Assurances

### 1. Personalize (`Redeemer::PERSONALIZE`)
- Accepts Handle, NFT SubHandle, and Virtual SubHandle paths.
- Enforces handle identity match (`datum.name` vs redeemer handle).
- Requires valid settings/provider reference inputs.
- Enforces contract-output policy and valid-contract allowlist membership.
- Validates fee routing:
  - treasury fee,
  - provider fee,
  - root-share fee for subhandles (outside grace period).
- Validates designer payload integrity:
  - CID multihash match,
  - default/forced style rules,
  - bounds checks for `pfp_zoom`, `pfp_offset`, `font_shadow_size`.
- Validates asset and media consistency:
  - approved BG/PFP assets,
  - required collection/attribute/display constraints,
  - BG/PFP image consistency with referenced datum.
- Enforces virtual constraints:
  - signer must match virtual assignee,
  - `resolved_addresses.ada` is immutable,
  - virtual payload immutability.
- Supports reset mode with strict reset authorization and private-data handling rules.

### 2. Migrate (`Redeemer::MIGRATE`)
- Requires output datum equality with input datum.
- Requires expected token class in selected output.
- Requires valid-contract checks.
- Requires admin signer; may also require owner token if `migrate_sig_required` is enabled.

### 3. Revoke (`Redeemer::REVOKE`)
- Only valid for virtual subhandles.
- Allows revoke when:
  - private mint + root handle proof, or
  - public mint + expired virtual lease.
- Requires burn (`minted == -1`) for the virtual token.

### 4. Update (`Redeemer::UPDATE`)
- Only valid for virtual subhandles.
- Restricts mutable fields to virtual metadata + resolved address.
- Requires protocol/root settings reference tokens.
- Supports three update authorities:
  - private flow with root proof,
  - public-expired flow with root proof and forced public->private transition,
  - assignee-signed public flow with payment constraints and minting-enabled checks.

### 5. Return to Sender (`Redeemer::RETURN_TO_SENDER`)
- Admin-only recovery path.
- Rejects outputs containing Handle reference (`LBL_100`) or root settings (`LBL_001`) tokens.

## Functional Requirements
- Compile `contract.helios` into deterministic artifacts under `./contract`.
- Maintain branch-traceable tests for all reachable assertion/error outcomes.
- Keep docs synchronized with contract behavior and branch coverage matrix.

## Success Criteria
- Contract artifacts compile reproducibly.
- Legacy scenario suite passes locally (`npm run test:old`).
- Tx scenario suite executes all defined cases when external fixture service is available.
- Contract assertion/error messages are all covered by tests or explicitly documented as unreachable wrappers.

## Operational Constraints
- Tx fixture generation depends on external CBOR conversion service availability.
- Temporary `503` responses are treated as external-runtime instability rather than contract-logic regressions.

# Runtime Flows

## Compile Flow
1. Read validator source from `contract.helios`.
2. Resolve optimization flag from `OPTIMIZE`.
3. Compile script and derive address/hash.
4. Write artifacts:
   - `contract/contract.json`
   - `contract/contract.hex`
   - `contract/contract.cbor`
   - `contract/contract.addr`
   - `contract/contract.hash`
   - `contract/contract.uplc`

## Personalize Flow (`PERSONALIZE`)
1. Decode old datum, resolve tx inputs/refs/outputs/signers.
2. Load and validate `PzSettings` reference input.
3. Resolve handle type path (`HANDLE`, `NFT_SUBHANDLE`, `VIRTUAL_SUBHANDLE`).
4. Validate contract output, immutable invariants, and last update address.
5. Validate BG/PFP approver refs and asset/datum consistency.
6. Validate required asset constraints and designer map/CID/default rules.
7. For non-reset flow, enforce fees (with grace-period bypass rules).
8. For reset flow, enforce reset authorization and private info reset restrictions.

## Migrate Flow (`MIGRATE`)
1. Resolve target output by redeemer index.
2. Require old datum equals new output datum.
3. Require expected token class and valid contract allowlist membership.
4. Require admin signer and optional owner-signature condition (`migrate_sig_required`).

## Revoke Flow (`REVOKE`)
1. Validate handle type is virtual subhandle.
2. Resolve old virtual mint state (`public_mint`, `expires_time`).
3. Allow only:
   - private mint + root proof, or
   - public mint + expired lease.
4. Require virtual token burn in minted value.

## Update Flow (`UPDATE`)
1. Validate handle type is virtual subhandle.
2. Resolve and validate protocol/root settings refs.
3. Require restricted mutability: NFT + personalization payload unchanged except allowed virtual/resolved fields.
4. Evaluate authority path:
   - private + root-signed,
   - public-expired + root-signed + force private,
   - assignee-signed public flow.
5. Enforce extension window and payment rules.

## Return-to-Sender Flow (`RETURN_TO_SENDER`)
1. Verify all returned outputs exclude Handle reference (`LBL_100`) and root settings (`LBL_001`) tokens.
2. Require admin signer.

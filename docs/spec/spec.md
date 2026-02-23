# Technical Spec

## Contract Entry Point
- Validator: `spending personalization` in `contract.helios`.
- Entry function: `main(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool`.
- Datum currently supported in-path: `Datum::CIP68`.

## Redeemers
- `PERSONALIZE { handle, root_handle, indexes, designer, reset }`
- `MIGRATE { handle, output_index }`
- `REVOKE { handle, root_handle, owner_index }`
- `UPDATE { handle, root_handle, indexes }`
- `RETURN_TO_SENDER`

## Shared Validation Helpers

### `load_pz_settings`
- Locates `PZ_HANDLE` (`LBL_222 + "pz_settings"`) in reference inputs.
- Parses `PzSettings` datum.
- Requires settings UTxO credential equals `settings_cred` validator hash.

### `is_valid_contract`
- Requires current validator hash is in `valid_contracts`.
- Requires selected contract output credential is in `valid_contracts`.

### `immutables_are_unchanged`
- Requires `standard_image`, `standard_image_hash`, and optional `original_address` unchanged.
- Requires all NFT fields except `image` and `mediaType` unchanged.
- Requires `agreed_terms == "https://handle.me/$/tou"`.

### `fees_are_paid`
- Grace period bypass when `last_edited_time + grace_period` still active.
- Otherwise requires:
  - treasury payment (`treasury_fee`) with handle datum,
  - provider payment (`pz_min_fee`, minus subhandle share) with handle datum,
  - subhandle root-share payment to root payment address.

### `designer_settings_are_valid`
- Verifies CID multihash equals serialized designer map hash.
- Evaluates forced/default/exclusive rules across style keys.
- Validates QR style shape (`square,*` or exact default, depending on force mode).
- Enforces numeric bounds:
  - `font_shadow_size`: x/y in `[-20,20]`, blur in `[0,20]`
  - `pfp_zoom`: `[100,200]`
  - `pfp_offset`: bounded by zoom-derived offset window.
- Validates text ribbon color semantics for gradient/non-gradient modes.

### `check_required_assets`
- Enforces optional `required_signature`.
- Enforces optional collection/pattern requirements (`require_asset_collections`).
- Enforces optional CIP-68 attribute checks (`require_asset_attributes`).
- Enforces optional display requirements (`require_asset_displayed`).

### `pz_datum_is_valid`
- Validates optional `validated_by` signer.
- Derives NSFW/trial values from approver policy flags and requires datum consistency.
- Requires BG/PFP asset/image presence symmetry.
- Requires BG/PFP image URLs match referenced datum images.

## Redeemer Branch Logic

### 1. `PERSONALIZE`

#### Common gating
- Handle redeemer must match datum name.
- Contract output must contain expected Handle asset class by handle type (`LBL_100` or `LBL_000`).
- `last_update_address` must match handle owner/assignee address context.
- Contract output + immutables must pass validation.

#### Handle type branch
- `HANDLE`:
  - Owner address from personalization asset output.
  - Disallows `resolved_addresses.ada` in new datum.
- `NFT_SUBHANDLE`:
  - Requires `name` ends with `@root_handle`.
  - Requires root settings token exists (`LBL_001 + root_handle`).
  - Requires personalization enabled by root or subhandle rules.
- `VIRTUAL_SUBHANDLE`:
  - Requires assignee signature unless reset.
  - Requires `resolved_addresses.ada` unchanged.
  - Requires virtual datum block unchanged.
  - Uses assignee address as canonical owner address.

#### Non-reset flow (`reset = false`)
- If designer changed:
  - Required assets must pass.
  - Fee policy must pass.
  - Designer payload/default enforcement must pass.
- If designer unchanged:
  - Allow only when designer exists or resulting datum is full reset form.

#### Reset flow (`reset = true`)
- Computes signer classes:
  - provider signer,
  - owner signer.
- Private info handling:
  - If holder changed: `socials` and `resolved_addresses` must be cleared.
  - If holder unchanged and no auth signer: `socials`/`resolved_addresses` must not be changed.
- Reset authorization:
  - If assets/default requirements fail OR provider/owner signed, full reset shape is required.
  - Otherwise reset is denied unless personalization payload is unchanged.

### 2. `MIGRATE`
- Output datum must equal input datum.
- Output must contain expected handle token class.
- Output must pass valid-contract check.
- Signer rules:
  - Admin signer required always.
  - Owner signer proof required when `migrate_sig_required` is enabled.

### 3. `REVOKE`
- Only `VIRTUAL_SUBHANDLE` is accepted.
- Valid revoke conditions:
  - private mint + root token proof, or
  - public mint + lease expired.
- Must burn virtual token (`minted == -1`).

### 4. `UPDATE`
- Only `VIRTUAL_SUBHANDLE` is accepted.
- Requires protocol settings token (`LBL_222 + "sh_settings"`).
- Requires root settings token (`LBL_001 + root_handle`).
- Requires no restricted changes:
  - personalization payload unchanged,
  - NFT map unchanged.

#### Update authority branch
- Private + root signed:
  - allow address change, or
  - allow extension if paid or admin signed.
- Public + root signed + expired:
  - allow only extension + main payment + force `public_mint = 0`.
- Assignee signed:
  - allow optional constrained address update,
  - allow extension with main+root payments,
  - require root virtual minting enabled.
- Otherwise deny with `No valid signature`.

### 5. `RETURN_TO_SENDER`
- Requires admin signer.
- Rejects outputs containing Handle reference (`LBL_100`) or root settings (`LBL_001`) assets.

## Test Surfaces
- Legacy scenario harness: `tests/tests.js` + `tests/contractTesting.js`.
- Tx fixture harness: `tests/txTests.ts` + `tests/fixtures.ts`.
- Compile-path unit tests: `tests/compile.test.js`.
- Contract message-coverage guard: `tests/contract.messages.test.js`.

## Runtime Constraints
- Tx fixture generation depends on remote CBOR conversion endpoint.
- Intermittent upstream `503` responses can block `test:new` execution independent of contract code correctness.

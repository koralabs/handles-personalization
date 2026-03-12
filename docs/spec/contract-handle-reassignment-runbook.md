# Contract Handle Reassignment Runbook

## Purpose
Use this runbook when a deployed contract handle must move from one on-chain state shape to another while preserving the contract datum, reference script, and deployment handle inventory.

This is the reusable playbook for:
- reassigning a contract from an old deployment handle to a new `*.handlecontract` handle,
- splitting oversized one-shot migrations into multiple transactions,
- rebuilding later transactions against the live outputs created by earlier ones,
- repeating the same flow across `preview`, `preprod`, and `mainnet`.

## What Is Generic
The reusable part of the flow is:

1. Identify the currently live contract UTxO.
2. Identify the new deployment handle UTxO.
3. Decide whether a one-shot reassignment fits within the tx size limit.
4. If it does not fit, build a prep transaction that separates the old and new handles into plain outputs and leaves a minimal shell UTxO behind.
5. Rebuild the final reassignment transaction against the live outputs produced by the prep transaction.
6. Sign and submit in order, validating chain state after each step.

This logic is expected to apply to the other contract repos and all three environments.

## Inputs You Need
Before building anything, capture:

- network: `preview`, `preprod`, or `mainnet`
- current contract UTxO: `tx_hash#index`
- new handle UTxO: `tx_hash#index`
- destination wallet address
- the current inline datum
- the current reference script, if one is attached
- the native script witness needed to spend the current holder address
- any extra ADA funding UTxO required to keep temporary outputs above minimum ADA

## Standard Reassignment Shape
If the transaction fits, the direct reassignment flow is:

1. Spend the current contract UTxO.
2. Spend the new handle UTxO.
3. Create one replacement contract output containing:
   - the required lovelace,
   - the new deployment handle,
   - the inline datum,
   - the reference script.
4. Return the old handle to the destination wallet in its own plain output if it must remain visible as a separate UTxO.

## Oversized Transaction Handling
If the direct reassignment exceeds the tx size limit, split it into two transactions.

### Step 1: Prep Transaction
The prep transaction should:

1. Spend the current contract UTxO.
2. Spend the new handle UTxO.
3. Spend an extra ADA funding input if the temporary shell or separated handle outputs would otherwise be underfunded.
4. Create a temporary shell output that contains:
   - the inline datum,
   - minimum ADA only,
   - no reference script,
   - no deployment handle.
5. Create a plain output for the old handle.
6. Create a plain output for the new handle with enough ADA to be used in the next step without adding another funding input.

The key size reduction is: do not carry the reference script in the prep shell.

### Step 2: Final Reassignment
The final reassignment transaction should:

1. Spend the prep shell output.
2. Spend the prep output holding the new handle.
3. Recreate the final contract output with:
   - the inline datum,
   - the reference script reattached,
   - the new deployment handle,
   - the required lovelace.

## Rebuild Rule
Never assume the planned txids are the txids that actually land.

After each submitted step:

1. Query live chain state.
2. Resolve the actual output references created on-chain.
3. Rebuild the next transaction against those live output references.

If a prep transaction lands under a different txid than the local artifact summary expected, every later artifact that depends on the planned txid is stale and must be rebuilt.

## Script Source Rule
Never treat generated tx-artifact folders as canonical sources for a contract script.

The only valid script source for a reassignment or repair is a live handle that already carries the intended reference script on-chain.

In practice:

1. fetch the reference script from the live source handle,
2. fetch the datum from the live datum-carrying handle,
3. build the new output from those live values,
4. after submission, compare the source-handle script and target-handle script directly.

Do not copy `reference-script-v2.json` from a previously generated folder into a later rebuild. That is how preview `pers6@handlecontract` drifted away from the intended `pz_contract_06` script.

The datum source handle and script source handle can be different. Personalization rollover is the concrete example:

1. script source: the old legacy handle still carrying the intended reference script,
2. datum source: the currently active contract handle being rolled forward.

If a contract family is using ordinal rollover, be explicit about both sources in the build inputs.

## Parity Gate
Every environment cutover must pass a script-parity check after reassignment.

The invariant is:

1. the live source handle script bytes,
2. and the live latest-assigned `*.handlecontract` script bytes

must match exactly.

Use `api.handle.me/scripts/check_contract_script_parity.py`.

The checker accepts either:

1. the built-in preview family list, or
2. an explicit pairs JSON file from the actual migration plan for `preprod` or `mainnet`

so later environments are not tied to hardcoded ordinals.

## Witness Rule
Keep native-script witnesses minimal.

For the flows above, attach only the native script witness actually required to spend the input address. Do not attach extra native scripts just because they are related to the wallet.

For the current preview wallet flow, the stable tracked payment-side witness is saved at [preview-wallet-payment-native-script.json](./assets/preview-wallet-payment-native-script.json).

For historical preview personalization reassignments, older contract UTxOs are still held by the legacy `pz_handles` wallet. The recovered payment-side witness for that holder is saved at [preview-pz-handles-payment-native-script.json](./assets/preview-pz-handles-payment-native-script.json).

When generating full tx artifacts, build the witness set with the Cardano serialization library, not ad hoc CBOR assembly. The preview reassignment batch initially produced files that looked superficially valid but were rejected because the witness set shape was wrong. The reliable pattern is:

1. build the tx body with `cardano-cli`,
2. decode the tx body bytes,
3. create `TransactionWitnessSet` with CSL,
4. attach the native scripts through `set_native_scripts`,
5. serialize the full `Transaction` back to bytes.

If a raw full tx file decodes in CSL and reports the expected native-script count, the witness-set shape is correct.

## Minimum ADA Rule
Temporary outputs still need enough ADA to satisfy the protocol minimum.

This matters most when a contract shell output still carries:
- an inline datum,
- a large multi-asset bundle,
- a reference script.

If the temporary split cannot satisfy minimum ADA from the current contract UTxO alone, add a separate funding input.

For the direct reassignment flow, do not assume the old contract output lovelace is automatically enough for the replacement output. A longer replacement handle name can push the script-bearing output over the minimum ADA threshold even when datum and reference script stay the same.

The preview DeMi reassignment exposed this exact failure:

- old output lovelace: `4,728,070`
- protocol-required minimum after replacing the handle: `4,741,000`

The pragmatic fix is to add an explicit lovelace buffer to the reassigned script-bearing output and reduce wallet change accordingly. The current batch generator uses a fixed `500,000` lovelace padding for that output so `preprod` and `mainnet` builds do not need per-contract manual tuning.

The same rule applies to in-place script refreshes. If the repaired output is rebuilding a handle UTxO with a larger reference script payload, the target UTxO's existing lovelace may no longer be enough after fees. In that case, add a plain ADA funding input from the same wallet before signing the refresh transaction.

## Validation Checklist
Validate each built transaction before signing:

1. Inputs match live UTxOs.
2. Output arithmetic balances exactly.
3. Every output meets minimum ADA.
4. The witness set contains the intended native script and nothing extra.
5. The shell output does or does not include a reference script exactly as intended for that step.
6. The handle assets end up in the expected outputs.
7. The tx size leaves room for the wallet signature.

After submission, validate on-chain:

1. the tx is confirmed,
2. the expected output indexes exist,
3. the handle assets moved to those outputs,
4. the datum/reference-script shape matches the intended step,
5. any next-step artifact is rebuilt against those live outputs.

## Personalization Preview Example
`pers1@handlecontract` on `preview` required the two-step path because the one-shot reassignment exceeded the tx size limit once signatures were added.

The successful pattern was:

1. Prep transaction separated:
   - old handle `pz_contract_06`,
   - new handle `pers1@handlecontract`,
   - a minimal shell UTxO with the inline datum only.
2. Final transaction spent:
   - the live shell output,
   - the live `pers1@handlecontract` output.
3. Final transaction recreated the contract output with:
   - the old inline datum,
   - the personalization reference script,
   - `pers1@handlecontract`.

This size problem appears to be specific to the personalization reassignment because of the combined datum and reference-script weight. Do not assume every other contract family needs the same split, but keep the split flow ready.

## Preview Bugs To Reuse
These bugs were found and fixed during the preview reassignment run and should be treated as part of the standard playbook for later environments:

1. Full tx witness sets must be serialized with CSL.
2. Reassigned script-bearing outputs need explicit ADA padding instead of blindly reusing the old lovelace amount.
3. Rebuilt artifacts must be validated after generation:
   - CSL can decode the full tx
   - native-script count matches expectations
   - the script-bearing output still contains the intended datum and reference script
4. `minting.handle.me/src/scripts/ensureHandlecontractSession.ts` must sign the payment tx with both wallets:
   - derivation `5` fee wallet
   - derivation `12` `handlecontract` root-owner wallet
   Using only the fee-wallet signature produces a payment tx that lands on-chain but cannot pass the strict verified pending-session flow.
5. Shell-exported values from `.gh.preview.env` must be sanitized with `tr -d '\r'` before reuse.
   Header-bearing variables like `HANDLE_ME_API_KEY` can carry CRLF and break outbound requests with `is not a legal HTTP header value`.

## Artifact Convention
Keep per-run artifacts under `tasks/tmp/<handle>-contract-reassignment-<network>/`.

For a split flow, keep:

- `step1-*.txbody`
- `step1-*.full.tx.cbor`
- `step1-*.full.tx.cbor.hex`
- `step2-*.txbody`
- `step2-*.full.tx.cbor`
- `step2-*.full.tx.cbor.hex`
- a `summary.json`

If a later transaction is rebuilt against live outputs, include `-live` in the filename.

## Environment Reuse
Run the same decision process for `preview`, `preprod`, and `mainnet`:

1. try the direct reassignment shape first,
2. if size fails, split into prep + final,
3. if minimum ADA fails, add an explicit funding input,
4. always rebuild later steps from live outputs, not planned txids.

That is the part future runs should reuse across contract repos.

## Historical Family Reorder
Personalization has an extra case that the other contract families do not: older deployed handles can still hold live script state even after a newer ordinal exists.

When that happens, do not only reassign the newest contract. First inventory the entire historical family, then reorder the family so the oldest live contract lands on the lowest new ordinal and the newest live contract lands on the highest ordinal.

Use the saved inventory helper:

- [inventory_personalization_family.py](../../scripts/inventory_personalization_family.py)

Example:

```bash
./scripts/inventory_personalization_family.py \
  --network preview \
  --legacy-max 6 \
  --family-max 6 \
  --output tasks/tmp/personalization-family-reassignment/preview.json
```

The generated JSON records:

1. every legacy `pz_contract_*` handle that still exists,
2. which validator hashes still hold any Handle reference token,
3. which `pers*@handlecontract` ordinals already exist,
4. the required ordered reassignment plan,
5. the missing `pers*@handlecontract` mints.

The latest personalization contract must land on the highest `pers*@handlecontract` ordinal in the final ordered set.

### Ordering Rule
If the newest contract is already on `pers1@handlecontract` but older `pz_contract_*` handles still hold live contract state, the correct move order is:

1. move the current newest contract to the highest new ordinal first,
2. then backfill the oldest historical contracts into `pers1`, `pers2`, `pers3`, and so on.

Preview currently demonstrates this exact case:

1. `pers1@handlecontract` -> `pers6@handlecontract`
2. `pz_contract_01` -> `pers1@handlecontract`
3. `pz_contract_02` -> `pers2@handlecontract`
4. `pz_contract_03` -> `pers3@handlecontract`
5. `pz_contract_04` -> `pers4@handlecontract`
6. `pz_contract_05` -> `pers5@handlecontract`

Saved preview inventory:

- `tasks/tmp/personalization-family-reassignment/preview.json`
- `tasks/tmp/personalization-family-reassignment/preview.md`
- `tasks/tmp/personalization-family-reassignment/preview-funding-plan.json`
- `tasks/tmp/personalization-family-reassignment/preview-funding-plan.md`

This same inventory-first reorder process should be repeated on `preprod` and `mainnet` before building the final reassignment batch for personalization.

### Historical Preview Reassignment Notes
The preview historical batch needed two additional rules that should carry forward to `preprod` and `mainnet`:

1. Use the current preview wallet payment witness for contracts already moved to the new wallet:
   - [preview-wallet-payment-native-script.json](./assets/preview-wallet-payment-native-script.json)
2. Use the legacy `pz_handles` payment witness for any still-live `pz_contract_*` UTxOs:
   - [preview-pz-handles-payment-native-script.json](./assets/preview-pz-handles-payment-native-script.json)

# Aiken validator iteration loop (local scalus eval)

Tight inner-loop for iterating on the four `pers*` Aiken validators
**without** re-publishing the on-chain reference scripts after every edit.
The on-chain ref UTxOs stay as-is; locally-compiled CBOR is swapped into the
scalus evaluator just before validation, so each iteration is:

```
edit aiken/validators/perspz.ak (or perslfc.ak / persprx.ak / persdsg.ak)
  → aiken build                       # writes plutus.json
  → extract compiledCode hex          # jq -r '.validators[].compiledCode'
  → set LOCAL_PERS_UNOPTIMIZED_CBOR_PATH=<file>
  → run e2e harness manifest          # against preview, but no submission
  → scalus eval reports pass / fail with traces
```

No on-chain mint, no @handlecontract publish, no partners-trie update per
iteration. Submission to preview chain is reserved for the **acceptance
gate** at the end (when scalus is green and you're ready to push the new
ref-scripts live).

## The four validators

After the size-driven splits, the contract suite is:

- **`persprx`** (spend proxy) — wraps the SubHandle UTxO spend; delegates to
  any Withdraw 0 observer in `valid_contracts`.
- **`perspz`** (Personalize observer) — withdraw observer that validates
  the Personalize redeemer.
- **`perslfc`** (lifecycle observer) — withdraw observer for
  Migrate / Revoke / Update / ReturnToSender redeemers.
- **`persdsg`** (designer-settings observer) — withdraw observer that
  validates `designer_settings_are_valid` on perspz's behalf for non-reset
  Personalize txs. **Must deploy before perspz** — perspz hardcodes
  persdsg's hash via `persdsg_hash` in `update.ak`.

## Compiling Aiken

```sh
cd handles-personalization
aiken build
# plutus.json now has all validator entries with their compiledCode
```

To extract a specific validator's compiled CBOR:

```sh
# perspz (Personalize observer)
jq -r '.validators[] | select(.title=="perspz.perspz.withdraw").compiledCode' \
  plutus.json > /tmp/perspz.cbor.hex

# perslfc (lifecycle observer)
jq -r '.validators[] | select(.title=="perslfc.perslfc.withdraw").compiledCode' \
  plutus.json > /tmp/perslfc.cbor.hex

# persprx (spend proxy)
jq -r '.validators[] | select(.title=="persprx.persprx.spend").compiledCode' \
  plutus.json > /tmp/persprx.cbor.hex

# persdsg (designer-settings observer)
jq -r '.validators[] | select(.title=="persdsg.persdsg.withdraw").compiledCode' \
  plutus.json > /tmp/persdsg.cbor.hex
```

The file must contain raw hex with no surrounding whitespace or quoting.

## Updating `persdsg_hash` after a persdsg edit

If you edit anything that `persdsg.ak` transitively reaches
(`designer_settings.ak`, base58 helpers, `dispatch_designer_settings_from_tx`,
etc.), persdsg's compiled bytecode — and therefore its hash — will change.
perspz hardcodes that hash, so it needs to be re-synced:

```sh
aiken build
jq -r '.validators[] | select(.title=="persdsg.persdsg.withdraw").hash' plutus.json
# copy that hex into `persdsg_hash` in aiken/lib/personalization/update.ak
aiken build  # rebuild perspz with the new hash
```

## Wiring into the e2e harness

Set the env var pointing at the file:

```sh
export LOCAL_PERS_UNOPTIMIZED_CBOR_PATH=/tmp/perspz.cbor.hex
```

The BFF's [`fetchUnoptimizedScriptCbor`](../../../handle.me/bff/lib/cardano/evaluateWithTrace.ts)
reads this file before falling back to its usual `api.handle.me/scripts`
fetch, so any tx the BFF builds will be locally-evaluated against your
freshly-compiled bytes.

Then run the manifest you care about:

```sh
cd handle.me/bff
npx tsx --test e2e/liveTxRunner.test.ts
```

Failures will surface as `evaluationTraces` in the `debugDump` of the build
result — the same trace strings you'd see if you submitted on-chain and the
validator rejected.

## What this loop tests vs what it doesn't

**Tests:**
- The validator logic itself (spend/mint/cert behavior on the redeemers,
  datums, and inputs/outputs the BFF builds).
- All the CIP-30 personalization scopes the e2e suite covers — currently
  03 (personalize-root), 04 (reset), 05 (migrate), 10 (NFT subhandle),
  11 (virtual subhandle).

**Does NOT test:**
- Tx-builder shape changes — the BFF still constructs the tx assuming the
  legacy `pz` interface (datum format, redeemer constructors, parameter
  set). If your new Aiken validator changes any of that, the BFF needs
  matching updates. Specifically: **non-reset Personalize txs now require
  a Withdraw 0 entry at persdsg's reward address** (in addition to perspz's).
- On-chain submission — fee math, script_data_hash matching against the
  on-chain ref-script, UTxO existence — those only show up at submission
  time and are minor compared to validator-logic bugs.
- The MPT proof against the on-chain partners-trie root — for new bg/pfp
  policies, the on-chain `pers_bg@handle_settings` / `pers_pfp@handle_settings`
  datums must encode the up-to-date root. See
  [`syncBgRootOnChain.js`](../../scripts/syncBgRootOnChain.js).

## Acceptance gate (when scalus is green)

1. Mint the four @handlecontract deployment handles
   (`persdsg1@handlecontract`, `perslfc1@handlecontract`,
   `persprx1@handlecontract`, `perspz1@handlecontract`) under the same
   compiled CBOR — see [`mintTestBackground.js`](../../scripts/mintTestBackground.js)
   for the native-script pattern, but using the canonical contract
   slug-naming rules from
   [`adahandle-deployments/docs/contract-deployment-pipeline.md`](../../../adahandle-deployments/docs/contract-deployment-pipeline.md).
   **Order matters** — `persdsg` first (perspz hardcodes its hash), then
   the rest.
2. Update the `pers@handle_settings` datum to register the new
   `valid_contracts` script hashes — requires multisig co-signing.
3. Unset `LOCAL_PERS_UNOPTIMIZED_CBOR_PATH` and re-run the e2e suite live
   against preview — the BFF now fetches the freshly-published
   `unoptimizedCbor` from `api.handle.me/scripts` and submission goes
   end-to-end.

# Aiken validator iteration loop (local scalus eval)

Tight inner-loop for iterating on `pers` and `persprx` Aiken validators
**without** re-publishing the on-chain reference script after every edit.
The on-chain ref UTxO stays as-is; locally-compiled CBOR is swapped into the
scalus evaluator just before validation, so each iteration is:

```
edit aiken/validators/pers.ak (or persprx.ak)
  → aiken build                       # writes plutus.json
  → extract compiledCode hex          # jq -r '.validators[].compiledCode'
  → set LOCAL_PERS_UNOPTIMIZED_CBOR_PATH=<file>
  → run e2e harness manifest          # against preview, but no submission
  → scalus eval reports pass / fail with traces
```

No on-chain mint, no @handlecontract publish, no partners-trie update per
iteration. Submission to preview chain is reserved for the **acceptance
gate** at the end (when scalus is green and you're ready to push the new
ref-script live).

## Compiling Aiken

```sh
cd handles-personalization
aiken build
# plutus.json now has all validator entries with their compiledCode
```

To extract just the spend validator's compiled CBOR:

```sh
jq -r '.validators[] | select(.title=="pers.spend").compiledCode' \
  plutus.json > /tmp/pers.cbor.hex
```

Or for the proxy:

```sh
jq -r '.validators[] | select(.title=="persprx.spend").compiledCode' \
  plutus.json > /tmp/persprx.cbor.hex
```

The file must contain raw hex with no surrounding whitespace or quoting.

## Wiring into the e2e harness

Set the env var pointing at the file:

```sh
export LOCAL_PERS_UNOPTIMIZED_CBOR_PATH=/tmp/pers.cbor.hex
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
  matching updates.
- On-chain submission — fee math, script_data_hash matching against the
  on-chain ref-script, UTxO existence — those only show up at submission
  time and are minor compared to validator-logic bugs.
- The MPT proof against the on-chain partners-trie root — for new bg/pfp
  policies, the on-chain `pers_bg@handle_settings` / `pers_pfp@handle_settings`
  datums must encode the up-to-date root. See
  [`syncBgRootOnChain.js`](../../scripts/syncBgRootOnChain.js).

## Acceptance gate (when scalus is green)

1. Mint the @handlecontract deployment handles
   (`pers1@handlecontract`, `persprx1@handlecontract`) under the same
   compiled CBOR — see [`mintTestBackground.js`](../../scripts/mintTestBackground.js)
   for the native-script pattern, but using the canonical contract
   slug-naming rules from
   [`adahandle-deployments/docs/contract-deployment-pipeline.md`](../../../adahandle-deployments/docs/contract-deployment-pipeline.md).
2. Update the `pers@handle_settings` datum to register the new
   `valid_contracts` script hashes — requires multisig co-signing.
3. Unset `LOCAL_PERS_UNOPTIMIZED_CBOR_PATH` and re-run the e2e suite live
   against preview — the BFF now fetches the freshly-published
   `unoptimizedCbor` from `api.handle.me/scripts` and submission goes
   end-to-end.

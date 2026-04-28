# AGENTS.md

## Master AGENTS.md
- [REQUIREMENT] Read the AGENTS.md in this project's parent folder for complete instructions and inter-project references

## DO NOT MINT HANDLES — EVER

This is the load-bearing rule for this repo. **Do not, under any circumstances, attempt to mint Kora handles from inside this repo or from any tooling you write here.** No `@cardano-sdk` mint-tx with the legacy handle policy. No `cardano-cli build/sign/submit` whose tx body includes a `mint` field for the legacy handle policy. No "just for the Phase E cutover" exceptions. No "just in preview to test it" exceptions.

Handles are minted by **`minting.handle.me`** — that is the only correct path, full stop. Bypassing it means bypassing the reservation state, collision detection, accounting, and refund logic that Kora's business depends on. The user's exact directive: *"the absolute only way to mint is through minting.handle.me. NEVER do anything else."* If a Phase E datum-attach workflow seems to require minting a fresh handle, the right action is to ask the user to mint it (via `minting.handle.me`) and then run `settingsAttachTx.js` against the resulting wallet UTxO. Never close the loop yourself.

This rule is about **minting** specifically. Other uses of the policy key — signing fee inputs from a derived wallet, contributing the policy-key witness to a settings-update tx that doesn't add new tokens, etc. — are fine and out of scope of this rule.

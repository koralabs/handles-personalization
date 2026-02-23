# Branch Coverage Matrix

This matrix maps contract assertion/error messages to scenario tests.

- `covered`: message text is asserted by at least one scenario test.
- `unreachable-wrapper`: defensive wrapper messages that are not reachable through valid typed paths (inner assertions fire first, or datum shape is statically constrained).

| Message | Status | Tests |
| --- | --- | --- |
| Asset datum not found | covered | `tests/tests.js` |
| Contract failed validation | unreachable-wrapper | n/a |
| Contract output not found in valid contracts list | covered | `tests/tests.js` |
| Contract output not present | covered | `tests/tests.js` |
| Current contract not found in valid contracts list | covered | `tests/tests.js` |
| Fee not paid to root Handle | covered | `tests/txTests.ts` |
| Handle input not present | covered | `tests/tests.js` |
| Handle redeemer mismatch | covered | `tests/tests.js` |
| Handle treasury fee unpaid | covered | `tests/tests.js` |
| Immutables have changed | covered | `tests/tests.js` |
| Incorrect root handle for SubHandle | covered | `tests/txTests.ts` |
| Invalid input datum | unreachable-wrapper | n/a |
| No valid signature | covered | `tests/txTests.ts` |
| Not a valid migration | covered | `tests/tests.js` |
| Only PubKeyHashes are supported | covered | `tests/txTests.ts` |
| Only valid for Virtual SubHandles | covered | `tests/txTests.ts` |
| Personalization designer settings hash doesn't match CID multihash | covered | `tests/tests.js` |
| Personalization properties not properly reset | covered | `tests/tests.js` |
| Personalization provider not found or fee unpaid | covered | `tests/tests.js` |
| Personalization settings checks failed | unreachable-wrapper | n/a |
| Protocol SubHandle settings not found | covered | `tests/txTests.ts` |
| Publicly minted Virtual SubHandle hasn't expired | covered | `tests/txTests.ts` |
| Required admin signer(s) not present | covered | `tests/tests.js` |
| Required asset not correct | covered | `tests/tests.js` |
| Required owner signer not present | covered | `tests/tests.js` |
| Required signature for background not present | covered | `tests/tests.js`, `tests/txTests.ts` |
| Reset is not allowed or not authorized | covered | `tests/tests.js` |
| Restricted changes are not allowed | covered | `tests/txTests.ts` |
| Root SubHandle settings not found | covered | `tests/txTests.ts` |
| Root SubHandle settings prohibit Personalization | covered | `tests/txTests.ts` |
| Root settings not found | covered | `tests/txTests.ts` |
| Socials need to be reset | covered | `tests/tests.js` |
| Socials shouldn't be reset | covered | `tests/tests.js` |
| SubHandle 'pz_enabled' should be 1 | covered | `tests/txTests.ts` |
| Trial/NSFW flags set incorrectly | covered | `tests/tests.js` |
| Tx not signed by virtual SubHandle holder | covered | `tests/txTests.ts` |
| Virtual SubHandle datum must not change | covered | `tests/txTests.ts` |
| agreed_terms must be set | covered | `tests/tests.js`, `tests/txTests.ts` |
| bg_asset/bg_image mismatch | covered | `tests/tests.js`, `tests/txTests.ts` |
| bg_image doesn't match bg_asset datum | covered | `tests/tests.js`, `tests/txTests.ts` |
| font_shadow_size is out of bounds | covered | `tests/tests.js` |
| last_update_address does not match Handle address | covered | `tests/tests.js` |
| pfp_asset/pfp_image mismatch | covered | `tests/tests.js`, `tests/txTests.ts` |
| pfp_image doesn't match pfp_asset datum | covered | `tests/tests.js`, `tests/txTests.ts` |
| pfp_offset is out of bounds | covered | `tests/tests.js` |
| pfp_zoom is out of bounds | covered | `tests/tests.js` |
| pz_settings reference input not from ADA Handle | covered | `tests/tests.js` |
| resolved_addresses can't contain 'ada' | covered | `tests/txTests.ts` |
| resolved_addresses need to be reset | covered | `tests/tests.js` |
| resolved_addresses shouldn't be reset | covered | `tests/tests.js` |
| resolved_addresses.ada must not change | covered | `tests/txTests.ts` |
| text_ribbon_colors is not set correctly | covered | `tests/tests.js` |
| validated_by is set but not signed | covered | `tests/tests.js` |

## Notes

- `tests/contract.messages.test.js` enforces that every contract message is either covered or in the explicit unreachable list.
- `tests/txTests.ts` now initializes with optional environment filters (`TEST_GROUP`, `TEST_NAME`) and runs the full suite by default.
- `test:new` depends on remote datum conversion; temporary upstream `503` responses can prevent execution even when logic/tests are correct.

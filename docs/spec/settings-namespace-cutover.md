# Personalization Settings Namespace Cutover

## Authority

New V3 personalization contracts use only these settings assets:

- `pers@handle_settings` — fees, credentials, contract registry, and observer registry
- `pers_bg@handle_settings` — background-policy MPF root
- `pers_pfp@handle_settings` — profile-picture-policy MPF root

The legacy `pz_settings`, `bg_policy_ids`, and `pfp_policy_ids` assets are not runtime authorities for the namespaced contracts.

## Why the proxy hash changes

The previously deployed `persprx` embedded the `pz_settings` LBL_222 asset name. Correcting the authority changes its hash from `7cf105586f77934a524c9e78f8879a33460104f9578e9ac927f577e3` to `7a04600f22a7101eaad5fdb86d0a91c78bf5c8eb29e86799bda830ed`.

Existing LBL_100 tokens remain spendable at the old proxy. They migrate through the normal migration transaction; they must not be force-moved or minted again.

## Migration bridge

An old proxy spend and its new observer execute in the same migration transaction:

1. The old proxy reads legacy `pz_settings`.
2. The new observer reads canonical `pers@handle_settings`.
3. Both settings UTxOs are reference inputs.
4. Both registries temporarily authorize the new proxy and observer hashes.
5. The LBL_100 output is locked at the new proxy.

Legacy `pz_settings` is therefore retained only as authority for an input already locked at an old proxy. Ordinary personalization, lifecycle, policy-root, and settings reads use the canonical handles exclusively.

## Ordered rollout per network

`node scripts/buildNamespaceCutover.js` emits one chained manifest:

1. Extend `pers@handle_settings`, including required `persdsg_hashes`.
2. Copy the currently authorized BG MPF root to `pers_bg@handle_settings`.
3. Copy the currently authorized PFP MPF root to `pers_pfp@handle_settings`.
4. Extend legacy `pz_settings` with only the hashes needed to migrate old proxy UTxOs.
5. Deploy the namespaced `perspz` reference script.
6. Deploy the namespaced `perslfc` reference script.
7. Deploy the namespaced `persprx` reference script.
8. Deploy the BFF that uses canonical settings and adds legacy `pz_settings` only to migration transactions.
9. Verify a normal personalize build and an old-proxy migration build.

Transactions are chained through the preceding transaction's deterministic ADA-only change output and must be signed and submitted in manifest order.

## Required verification

For each network:

- Canonical settings have ten fields.
- Canonical `valid_contracts` contains `7a04600f…`, `5298e0e1…`, `51530e22…`, and `1fcfe6fd…`.
- Canonical `persdsg_hashes` contains `1fcfe6fd…`.
- Canonical BG/PFP roots equal the roots used by the deployed BFF proof source.
- API script hashes equal the compiled hashes.
- A normal personalization build includes canonical settings references and excludes legacy settings.
- A migration build includes both canonical `pers@handle_settings` and legacy `pz_settings` references.
- The guarded mainnet smoke reaches wallet signing but signs and submits nothing.

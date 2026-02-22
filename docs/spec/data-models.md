# Data Models

## Key Structures

### CIP-68 Personalization Datum
- Includes NFT metadata and personalization `extra` fields such as:
  - `bg_image`,
  - `pfp_image`,
  - `designer`,
  - `portal`,
  - `socials`,
  - policy-linked asset references.

### Personalization Settings Datum
- Includes fee and governance/admin config:
  - treasury/provider fees,
  - provider and admin credential maps,
  - valid contract references,
  - grace period and revenue split values.

### Redeemers
- Personalize redeemer with:
  - handle identity,
  - index mapping (`PzIndexes`),
  - designer payload map,
  - reset flag.
- Additional migrate/return redeemer classes for scenario coverage.

### Script Context Fixtures
- Fixture builders generate deterministic:
  - inputs,
  - reference inputs,
  - outputs,
  - signers,
  used in contract scenario tests.

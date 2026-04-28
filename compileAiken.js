import { execSync } from "node:child_process";
import fs from "node:fs";

import { Cardano } from "./helpers/cardano-sdk/index.js";
import { getAikenArtifactPaths, PERSONALIZATION_VALIDATOR_SLUGS } from "./compileHelpers.js";

const artifactPaths = getAikenArtifactPaths();

execSync("aiken build --trace-level silent", {
  cwd: "./aiken",
  stdio: "inherit",
});

fs.mkdirSync(artifactPaths.directory, { recursive: true });
fs.copyFileSync("./aiken/plutus.json", artifactPaths.blueprint);

const blueprint = JSON.parse(fs.readFileSync(artifactPaths.blueprint, "utf8"));

const validatorsRaw = [...(blueprint.validators || [])].sort((a, b) =>
  a.title.localeCompare(b.title)
);

// Plutus.json titles are "<file>.<validator_name>.<handler>" — group by file.
const parseTitle = (title) => {
  const parts = title.split(".");
  if (parts.length < 3) {
    throw new Error(`unexpected validator title shape: ${title}`);
  }
  return { fileSlug: parts[0], handler: parts[parts.length - 1] };
};

const buildScriptCredential = (hashHex) => ({
  type: Cardano.CredentialType.ScriptHash,
  hash: hashHex,
});

const buildAddresses = (hashHex) => ({
  testnet: Cardano.EnterpriseAddress.fromCredentials(0, buildScriptCredential(hashHex))
    .toAddress()
    .toBech32(),
  mainnet: Cardano.EnterpriseAddress.fromCredentials(1, buildScriptCredential(hashHex))
    .toAddress()
    .toBech32(),
});

const buildStakeAddresses = (hashHex) => ({
  testnet: Cardano.RewardAddress.fromCredentials(0, buildScriptCredential(hashHex))
    .toAddress()
    .toBech32(),
  mainnet: Cardano.RewardAddress.fromCredentials(1, buildScriptCredential(hashHex))
    .toAddress()
    .toBech32(),
});

// Group entries by file slug, picking the canonical entry per slug. The
// canonical entry is the spend or withdraw handler (whichever exists);
// "else" is a fallback that compiles to the same script — skip it.
const validatorsBySlug = new Map();
for (const entry of validatorsRaw) {
  const { fileSlug, handler } = parseTitle(entry.title);
  if (handler === "else") continue;
  if (!validatorsBySlug.has(fileSlug)) validatorsBySlug.set(fileSlug, []);
  validatorsBySlug.get(fileSlug).push({ ...entry, handler });
}

// Sanity-check that each declared slug is present.
for (const slug of PERSONALIZATION_VALIDATOR_SLUGS) {
  if (!validatorsBySlug.has(slug)) {
    throw new Error(`Aiken blueprint missing validator file ${slug}`);
  }
}

const validatorMetadata = [];
const addresses = [];

for (const slug of [...validatorsBySlug.keys()].sort()) {
  const entries = validatorsBySlug.get(slug);
  // All non-"else" handlers in one file produce the same script hash (Aiken
  // multi-handler validators share a binary), so we can pick any.
  const canonical = entries[0];
  const handlers = entries.map((e) => e.handler);
  const addr = buildAddresses(canonical.hash);

  const meta = {
    slug,
    title: canonical.title,
    handlers,
    hash: canonical.hash,
    address_testnet: addr.testnet,
    address_mainnet: addr.mainnet,
    compiledCode: canonical.compiledCode,
  };
  validatorMetadata.push(meta);
  addresses.push({
    slug,
    title: canonical.title,
    handlers,
    hash: canonical.hash,
    address_testnet: addr.testnet,
    address_mainnet: addr.mainnet,
  });

  const paths = artifactPaths.perValidator(slug);
  fs.writeFileSync(paths.hash, `${canonical.hash}\n`);
  fs.writeFileSync(paths.addrTestnet, `${addr.testnet}\n`);
  fs.writeFileSync(paths.addrMainnet, `${addr.mainnet}\n`);
  fs.writeFileSync(paths.compiledCbor, canonical.compiledCode);

  // Withdraw validators also need a reward (stake) address — that's the form
  // used when registering the script as a withdrawal credential and when
  // matching `transaction.Withdraw(credential)` in the proxy delegation.
  if (handlers.includes("withdraw")) {
    const stake = buildStakeAddresses(canonical.hash);
    fs.writeFileSync(paths.stakeAddrTestnet, `${stake.testnet}\n`);
    fs.writeFileSync(paths.stakeAddrMainnet, `${stake.mainnet}\n`);
  }
}

fs.writeFileSync(
  artifactPaths.validators,
  `${JSON.stringify({ validators: validatorMetadata }, null, 2)}\n`
);
fs.writeFileSync(
  artifactPaths.addresses,
  `${JSON.stringify({ validators: addresses }, null, 2)}\n`
);

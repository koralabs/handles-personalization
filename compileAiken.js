import { execSync } from "node:child_process";
import fs from "node:fs";
import * as helios from "@koralabs/helios";
import { getAikenArtifactPaths } from "./compileHelpers.js";

const artifactPaths = getAikenArtifactPaths();

execSync("aiken build --trace-level silent", {
  cwd: "./aiken",
  stdio: "inherit",
});

fs.mkdirSync(artifactPaths.directory, { recursive: true });
fs.copyFileSync("./aiken/plutus.json", artifactPaths.blueprint);

const blueprint = JSON.parse(fs.readFileSync(artifactPaths.blueprint, "utf8"));
const validators = [...(blueprint.validators || [])].sort((a, b) =>
  a.title.localeCompare(b.title)
);

const toAddressBundle = (hashHex) => {
  const hash = helios.ValidatorHash.fromHex(hashHex);
  helios.config.set({ IS_TESTNET: true });
  const testnet = helios.Address.fromValidatorHash(hash).toBech32();
  helios.config.set({ IS_TESTNET: false });
  const mainnet = helios.Address.fromValidatorHash(hash).toBech32();

  return { testnet, mainnet };
};

const validatorMetadata = validators.map((validator) => {
  const addresses = toAddressBundle(validator.hash);
  return {
    title: validator.title,
    hash: validator.hash,
    address_testnet: addresses.testnet,
    address_mainnet: addresses.mainnet,
    compiledCode: validator.compiledCode,
  };
});

const addresses = validatorMetadata.map((validator) => ({
  title: validator.title,
  hash: validator.hash,
  address_testnet: validator.address_testnet,
  address_mainnet: validator.address_mainnet,
}));

const spendValidator =
  validatorMetadata.find((validator) => validator.title.endsWith(".spend")) ||
  validatorMetadata[0];

if (!spendValidator) {
  throw new Error("No validators found in Aiken blueprint");
}

fs.writeFileSync(
  artifactPaths.validators,
  `${JSON.stringify({ validators: validatorMetadata }, null, 2)}\n`
);
fs.writeFileSync(
  artifactPaths.addresses,
  `${JSON.stringify({ validators: addresses }, null, 2)}\n`
);
fs.writeFileSync(artifactPaths.spendHash, `${spendValidator.hash}\n`);
fs.writeFileSync(artifactPaths.spendAddrTestnet, `${spendValidator.address_testnet}\n`);
fs.writeFileSync(artifactPaths.spendAddrMainnet, `${spendValidator.address_mainnet}\n`);

export const resolveOptimizeFlag = (optimizeValue) =>
  Boolean(optimizeValue || false);

export const getContractArtifactPaths = (contractDirectory = "./contract") => {
  const directory = contractDirectory.endsWith("/")
    ? contractDirectory.slice(0, -1)
    : contractDirectory;

  return {
    directory,
    json: `${directory}/contract.json`,
    hex: `${directory}/contract.hex`,
    cbor: `${directory}/contract.cbor`,
    addr: `${directory}/contract.addr`,
    hash: `${directory}/contract.hash`,
    uplc: `${directory}/contract.uplc`,
  };
};

// Canonical slugs per adahandle-deployments/docs/contract-deployment-pipeline.md.
// Match the validator file names under aiken/validators/. Alpha-ordered (the
// deploy plan iterates in this order).
export const PERSONALIZATION_VALIDATOR_SLUGS = [
    "persdsg",
    "perslfc",
    "persprx",
    "perspz",
];

export const getAikenArtifactPaths = (contractDirectory = "./contract") => {
  const directory = contractDirectory.endsWith("/")
    ? contractDirectory.slice(0, -1)
    : contractDirectory;

  return {
    directory,
    blueprint: `${directory}/aiken.plutus.json`,
    validators: `${directory}/aiken.validators.json`,
    addresses: `${directory}/aiken.addresses.json`,
    perValidator: (slug) => ({
      slug,
      hash: `${directory}/aiken.${slug}.hash`,
      addrTestnet: `${directory}/aiken.${slug}.addr_testnet`,
      addrMainnet: `${directory}/aiken.${slug}.addr_mainnet`,
      stakeAddrTestnet: `${directory}/aiken.${slug}.stake_addr_testnet`,
      stakeAddrMainnet: `${directory}/aiken.${slug}.stake_addr_mainnet`,
      compiledCbor: `${directory}/aiken.${slug}.compiled.cbor`,
    }),
  };
};

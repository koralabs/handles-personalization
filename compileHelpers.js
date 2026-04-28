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

// Slugs match the validator file names under aiken/validators/.
// Keep alpha-ordered (the deploy plan iterates in this order).
export const PERSONALIZATION_VALIDATOR_SLUGS = ["pers_logic", "pers_proxy"];

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

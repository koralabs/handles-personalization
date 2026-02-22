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


import { execFileSync } from "node:child_process";
import fs from "node:fs";

import * as helios from "@koralabs/helios";

import { getAikenArtifactPaths } from "./compileHelpers.js";

const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const HANDLE_PREFIX_222 = "000de140";

const networkParametersUrl = (network) => `https://network-status.helios-lang.io/${network}/config`;

const compilePersonalizationArtifacts = () => {
  execFileSync("node", ["./compileAiken.js"], { stdio: "inherit" });
};

// Reads the optimized UPLC CBOR for a given validator slug from the per-
// validator artifact written by compileAiken.js.
const loadPersonalizationProgram = ({
  contractSlug,
  compileFn = compilePersonalizationArtifacts,
  artifactPaths = getAikenArtifactPaths(),
} = {}) => {
  if (!contractSlug) {
    throw new Error("loadPersonalizationProgram: contractSlug is required");
  }
  compileFn();
  const compiledCborPath = artifactPaths.perValidator(contractSlug).compiledCbor;
  if (!fs.existsSync(compiledCborPath)) {
    throw new Error(
      `compiled CBOR not found for contract ${contractSlug} at ${compiledCborPath}`
    );
  }
  const compiledCbor = fs.readFileSync(compiledCborPath, "utf8").trim();
  return helios.UplcProgram.fromCbor(compiledCbor);
};

export const fetchNetworkParameters = async (network, fetchFn = fetch) =>
  new helios.NetworkParams(await (await fetchFn(networkParametersUrl(network))).json());

export const buildReferenceScriptDeploymentTx = async ({
  network,
  contractSlug,
  handleName,
  changeAddress,
  cborUtxos,
  loadProgramFn = loadPersonalizationProgram,
  fetchNetworkParametersFn = fetchNetworkParameters,
}) => {
  if (!contractSlug) {
    throw new Error("buildReferenceScriptDeploymentTx: contractSlug is required");
  }
  const networkParams = await fetchNetworkParametersFn(network);
  const address = helios.Address.fromBech32(changeAddress);
  if (!address.pubKeyHash) {
    throw new Error("Must be Base wallet to deploy");
  }

  const spareUtxos = cborUtxos.map((utxo) => helios.TxInput.fromFullCbor(utxo));
  const handleValue = new helios.Value(
    1n,
    new helios.Assets([
      [HANDLE_POLICY_ID, [[`${HANDLE_PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`, 1n]]],
    ])
  );
  const handleInputIndex = spareUtxos.findIndex((utxo) => utxo.value.ge(handleValue));
  if (handleInputIndex < 0) {
    throw new Error(`You don't have $${handleName} handle`);
  }

  const tx = new helios.Tx();
  tx.addInput(spareUtxos.splice(handleInputIndex, 1)[0]);

  const output = new helios.TxOutput(address, handleValue, null, loadProgramFn({ contractSlug }));
  output.correctLovelace(networkParams);
  tx.addOutput(output);

  return await tx.finalize(networkParams, address, spareUtxos);
};

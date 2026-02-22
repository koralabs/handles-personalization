import * as helios from "@koralabs/helios";
import fs from "fs";
import {
    getContractArtifactPaths,
    resolveOptimizeFlag,
} from "./compileHelpers.js";

const OPTIMIZE = resolveOptimizeFlag(process.env.OPTIMIZE);
//helios.config.set({IS_TESTNET: false})
let contractHelios = fs.readFileSync("./contract.helios").toString();
let program = helios.Program.new(contractHelios);
console.log(`OPTIMIZE is set to ${OPTIMIZE}`);
const contract = program.compile(OPTIMIZE);
const address = helios.Address.fromValidatorHash(contract.validatorHash);

const artifactPaths = getContractArtifactPaths();

fs.mkdirSync(artifactPaths.directory, {recursive: true});
fs.writeFileSync(artifactPaths.json, contract.serialize());
fs.writeFileSync(artifactPaths.hex, JSON.parse(contract.serialize()).cborHex);
fs.writeFileSync(
    artifactPaths.cbor,
    Buffer.from(JSON.parse(contract.serialize()).cborHex, "hex")
);
fs.writeFileSync(artifactPaths.addr, address.toBech32());
fs.writeFileSync(artifactPaths.hash, contract.validatorHash.hex);
fs.writeFileSync(artifactPaths.uplc, contract.toString());

// IN CLI:
// helios compile contract.helios --optimize -o contract.json
// helios address contract.json (add -m for mainnet) > contract_testnets.address
// cat contract_testnets.address | cardano-address address inspect (look for the spending_shared_hash)

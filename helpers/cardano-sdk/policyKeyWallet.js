// Pure-JS BIP32 key derivation from the POLICY_KEY env var (bech32 xprv root).
// Mirrors the documented derivation tree in
// minting.handle.me/src/helpers/cardano/wallet.ts:
//   0      = Policy Key (root, no further derivation)
//   1 - 10 = Minting Addresses
//   11     = Refund Address
//   12     = Handle Prices (kora-team admin wallet — holds @handlecontract,
//            kora@handle_prices; this is the deployer/cutover wallet)
//   13     = Approved Minter
//
// Path m/1852'/1815'/0'/0/<derivation>. Hardened on the first three.
//
// Uses @stricahq/bip32ed25519 for pure-JS derivation (no CSL — same library
// decentralized-minting uses).

import { Buffer } from "node:buffer";
import { bech32 } from "bech32";

import * as StrictaBip32Module from "@stricahq/bip32ed25519";

import { Cardano } from "./index.js";

const HARDENED = 0x80000000;
// `@stricahq/bip32ed25519` is published as a CJS package with a default
// export; under Node ESM the runtime sees both `default` and named keys.
// Resolve at call time to avoid TDZ issues during top-level parsing.
const getBip32PrivateKey = () =>
  StrictaBip32Module.Bip32PrivateKey ??
  StrictaBip32Module.default?.Bip32PrivateKey;

const decodeBech32Xprv = (bech) => {
  const decoded = bech32.decode(bech, 1023);
  return Buffer.from(bech32.fromWords(decoded.words));
};

const enterpriseAddressForCredential = (publicKeyHashHex, networkId) => {
  const credential = {
    type: Cardano.CredentialType.KeyHash,
    hash: publicKeyHashHex,
  };
  return Cardano.EnterpriseAddress.fromCredentials(networkId, credential)
    .toAddress()
    .toBech32();
};

// `derivation` = the index after the standard m/1852'/1815'/0'/0/ prefix.
// `network` = "preview" | "preprod" | "mainnet" (mainnet = networkId 1).
//
// Returns { privateKey, publicKey, publicKeyHash, address }.
//   privateKey: the @stricahq PrivateKey (use `.sign(buffer)` to get an
//     Ed25519 signature)
//   publicKey: 32-byte Buffer
//   publicKeyHash: blake2b-224 hex
//   address: enterprise bech32 (matches getHandlecontractPaymentAddress for
//     derivation 12)
export const getPolicyWallet = ({
  policyKeyBech32,
  derivation,
  network,
}) => {
  if (!policyKeyBech32 || typeof policyKeyBech32 !== "string") {
    throw new Error("getPolicyWallet: policyKeyBech32 (POLICY_KEY) is required");
  }
  if (typeof derivation !== "number") {
    throw new Error("getPolicyWallet: derivation (number) is required");
  }
  if (!network) {
    throw new Error("getPolicyWallet: network is required");
  }

  const networkId = network === "mainnet" ? 1 : 0;
  const xprvBytes = decodeBech32Xprv(policyKeyBech32.trim());
  const Bip32PrivateKey = getBip32PrivateKey();
  if (!Bip32PrivateKey) {
    throw new Error("getPolicyWallet: failed to resolve Bip32PrivateKey from @stricahq/bip32ed25519");
  }
  const rootKey = new Bip32PrivateKey(xprvBytes);

  const accountKey = rootKey
    .derive(HARDENED + 1852)
    .derive(HARDENED + 1815)
    .derive(HARDENED + 0);
  const childKey = accountKey.derive(0).derive(derivation);

  const privateKey = childKey.toPrivateKey();
  const publicKey = privateKey.toPublicKey();
  const publicKeyBytes = Buffer.from(publicKey.toBytes());
  const publicKeyHash = Buffer.from(publicKey.hash()).toString("hex");

  return {
    privateKey,
    publicKey: publicKeyBytes,
    publicKeyHash,
    address: enterpriseAddressForCredential(publicKeyHash, networkId),
  };
};

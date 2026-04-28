import { Buffer } from "node:buffer";

import cbor from "cbor";

import { mergeVkeysIntoTxCbor } from "./cborSplice.js";
import { Serialization } from "./index.js";

// Sign an unsigned Conway tx CBOR with a derived policy-wallet private key
// and return the signed tx CBOR. Splices the vkey witness into the existing
// witness_set via cborSplice so any pre-existing scripts/redeemers/datums
// are preserved byte-for-byte.
//
// `wallet` is the result of `getPolicyWallet({ ... })`:
//   { privateKey, publicKey, publicKeyHash, address }
//
// privateKey must be a @stricahq/bip32ed25519 PrivateKey (has `.sign(buf)`).
// publicKey must be a 32-byte Buffer.
export const signTxWithWallet = (unsignedTxCborHex, wallet) => {
  const stripped = unsignedTxCborHex.startsWith("0x")
    ? unsignedTxCborHex.slice(2)
    : unsignedTxCborHex;
  const tx = Serialization.Transaction.fromCbor(stripped);
  const body = tx.body();
  const bodyHash = Buffer.from(body.hash(), "hex");

  const signatureBytes = wallet.privateKey.sign(bodyHash);
  if (!signatureBytes || signatureBytes.length !== 64) {
    throw new Error(
      `signTxWithWallet: expected 64-byte Ed25519 signature, got ${signatureBytes?.length}`
    );
  }

  // CBOR-encode a witness_set with a single vkey witness:
  //   { 0 => [ [public_key, signature] ] }
  const sigOnlyWitnessSet = cbor.encode(
    new Map([[0, [[Buffer.from(wallet.publicKey), Buffer.from(signatureBytes)]]]])
  );

  return mergeVkeysIntoTxCbor(stripped, sigOnlyWitnessSet.toString("hex"));
};

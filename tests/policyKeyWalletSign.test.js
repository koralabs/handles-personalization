import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { bech32 } from "bech32";
import * as Bip32 from "@stricahq/bip32ed25519";

import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";
import { submitAnchorSelfTx } from "../helpers/cardano-sdk/anchorTx.js";
import { signTxWithWallet } from "../helpers/cardano-sdk/signTx.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";

// A throwaway root key made from fixed entropy; never a real POLICY_KEY.
const rootKeyBech32 = async () => {
  const Key = Bip32.Bip32PrivateKey ?? Bip32.default.Bip32PrivateKey;
  const root = await Key.fromEntropy(Buffer.alloc(32, 7));
  return bech32.encode("root_xsk", bech32.toWords(root.toBytes()), 1023);
};

test("getPolicyWallet derives stable per-index keys and network-specific addresses", async () => {
  const policyKeyBech32 = await rootKeyBech32();
  const a = getPolicyWallet({ policyKeyBech32: ` ${policyKeyBech32}\n`, derivation: 12, network: "preview" });
  const again = getPolicyWallet({ policyKeyBech32, derivation: 12, network: "preview" });
  const other = getPolicyWallet({ policyKeyBech32, derivation: 13, network: "preview" });
  const main = getPolicyWallet({ policyKeyBech32, derivation: 12, network: "mainnet" });

  assert.equal(a.publicKey.length, 32);
  assert.match(a.publicKeyHash, /^[0-9a-f]{56}$/);
  assert.equal(a.address, again.address);
  assert.notEqual(a.publicKeyHash, other.publicKeyHash);
  assert.match(a.address, /^addr_test1/);
  assert.match(main.address, /^addr1/);
  assert.equal(main.publicKeyHash, a.publicKeyHash); // network only changes the address prefix
});

test("getPolicyWallet refuses missing or malformed inputs", async () => {
  const policyKeyBech32 = await rootKeyBech32();
  assert.throws(() => getPolicyWallet({ derivation: 1, network: "preview" }), /policyKeyBech32/);
  assert.throws(() => getPolicyWallet({ policyKeyBech32, derivation: "1", network: "preview" }), /derivation/);
  assert.throws(() => getPolicyWallet({ policyKeyBech32, derivation: 1 }), /network/);
  assert.throws(() => getPolicyWallet({ policyKeyBech32: "not-bech32", derivation: 1, network: "preview" }));
});

test("signTxWithWallet adds one valid vkey witness for the tx body and keeps the body unchanged", async () => {
  const wallet = getPolicyWallet({ policyKeyBech32: await rootKeyBech32(), derivation: 12, network: "preview" });
  // [body {0: [], 1: [], 2: 0}, witness_set {}, true, null]
  const unsigned = "84a3008001800200a0f5f6";
  const signedHex = signTxWithWallet(`0x${unsigned}`, wallet);

  const signed = Serialization.Transaction.fromCbor(signedHex);
  const witnesses = signed.witnessSet().vkeys().values();
  assert.equal(witnesses.length, 1);
  const bodyHash = Buffer.from(signed.body().hash(), "hex");
  assert.equal(signed.body().hash(), Serialization.Transaction.fromCbor(unsigned).body().hash());
  assert.equal(witnesses[0].vkey(), wallet.publicKey.toString("hex"));
  assert.equal(wallet.privateKey.toPublicKey().verify(Buffer.from(witnesses[0].signature(), "hex"), bodyHash), true);
});

test("signTxWithWallet rejects a signer that does not produce a 64-byte signature", () => {
  const badWallet = { privateKey: { sign: () => Buffer.alloc(10) }, publicKey: Buffer.alloc(32) };
  assert.throws(() => signTxWithWallet("84a3008001800200a0f5f6", badWallet), /expected 64-byte Ed25519 signature, got 10/);
});

// Refused before any network call: a missing argument must never reach Blockfrost or submit a tx.
test("submitAnchorSelfTx refuses missing network, wallet address or Blockfrost key", async () => {
  const wallet = { address: "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej" };
  await assert.rejects(submitAnchorSelfTx({ wallet, blockfrostApiKey: "k" }), /network is required/);
  await assert.rejects(submitAnchorSelfTx({ network: "preview", wallet: {}, blockfrostApiKey: "k" }), /wallet \(with \.address\) is required/);
  await assert.rejects(submitAnchorSelfTx({ network: "preview", wallet }), /blockfrostApiKey is required/);
});

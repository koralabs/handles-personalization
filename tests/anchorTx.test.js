import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { bech32 } from "bech32";
import * as Bip32 from "@stricahq/bip32ed25519";

import { submitAnchorSelfTx } from "../helpers/cardano-sdk/anchorTx.js";
import { getPolicyWallet } from "../helpers/cardano-sdk/policyKeyWallet.js";
import { Serialization } from "../helpers/cardano-sdk/index.js";

const PARAMS = {
  a0: 0.3, coins_per_utxo_size: 4310, collateral_percent: 150,
  cost_models_raw: { PlutusV1: new Array(166).fill(0), PlutusV2: new Array(175).fill(0), PlutusV3: new Array(297).fill(0) },
  e_max: 18, key_deposit: 2000000, max_block_ex_mem: 62000000, max_block_ex_steps: 20000000000,
  max_block_header_size: 1100, max_block_size: 90112, max_collateral_inputs: 3, pool_deposit: 500000000,
  max_tx_ex_mem: 14000000, max_tx_ex_steps: 10000000000, max_tx_size: 16384, max_val_size: 5000,
  min_fee_a: 44, min_fee_b: 155381, min_fee_ref_script_cost_per_byte: 15, min_pool_cost: 170000000,
  n_opt: 500, price_mem: 0.0577, price_step: 0.0000721, protocol_major_ver: 10, protocol_minor_ver: 0,
  rho: 0.003, tau: 0.2,
};
const SUBMITTED_HASH = "cd".repeat(32);
const TOKEN_UNIT = "f0".repeat(28) + "0001";

const makeWallet = async () => {
  const Key = Bip32.Bip32PrivateKey ?? Bip32.default.Bip32PrivateKey;
  const root = await Key.fromEntropy(Buffer.alloc(32, 9));
  const policyKeyBech32 = bech32.encode("root_xsk", bech32.toWords(root.toBytes()), 1023);
  return getPolicyWallet({ policyKeyBech32, derivation: 12, network: "preview" });
};

// Fake Blockfrost: records submitted bodies; `utxos` is the address's UTxO list.
const withBlockfrost = async (utxos, fn) => {
  const submitted = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (u.endsWith("/blocks/latest")) return json({ hash: "0".repeat(64), slot: 70000000 });
    if (u.endsWith("/genesis")) return json({ network_magic: 2 });
    if (u.endsWith("/epochs/latest/parameters")) return json(PARAMS);
    if (u.includes("/utxos?page=")) return json(u.includes("page=1&") ? utxos : []);
    if (u.endsWith("/tx/submit")) {
      submitted.push(options.body);
      return new Response(`"${SUBMITTED_HASH}"`, { status: 200 });
    }
    return new Response(`unmocked URL: ${u}`, { status: 500 });
  };
  try {
    return await fn(submitted);
  } finally {
    globalThis.fetch = original;
  }
};

const utxo = (byte, lovelace, extra = []) => ({
  tx_hash: byte.repeat(32), output_index: 0,
  amount: [{ unit: "lovelace", quantity: String(lovelace) }, ...extra],
});

test("anchor tx spends only ada-only UTxOs, pays the same wallet, and submits a signed tx", async () => {
  // Feature: Phase E anchors each reservation with a real self-payment tx.
  // Failure: spending a token UTxO, paying elsewhere, or submitting unsigned loses assets or breaks the anchor.
  // Negative control: dropping the no-asset filter lets the random selector pick the token UTxO (likely within 12 runs) and fails the input assertion.
  const wallet = await makeWallet();
  const utxos = [
    utxo("aa", 3_000_000, [{ unit: TOKEN_UNIT, quantity: "1" }]),
    utxo("bb", 50_000_000),
    utxo("cc", 20_000_000),
  ];
  await withBlockfrost(utxos, async (submitted) => {
    for (let i = 0; i < 11; i++) { // the selector is random: repeat so a token UTxO would be picked
      const r = await submitAnchorSelfTx({ network: "preview", wallet, blockfrostApiKey: "k" });
      const inputs = Serialization.Transaction.fromCbor(r.cborHex).body().toCore().inputs.map((x) => x.txId);
      assert.ok(inputs.length > 0 && inputs.every((id) => id !== "aa".repeat(32)));
    }
    submitted.length = 0;
    const result = await submitAnchorSelfTx({ network: "preview", wallet, blockfrostApiKey: "k" });
    assert.equal(result.txHash, SUBMITTED_HASH);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].toString("hex"), result.cborHex);

    const tx = Serialization.Transaction.fromCbor(result.cborHex);
    const body = tx.body().toCore();
    const spent = body.inputs.reduce((sum, i) => sum + { [("bb").repeat(32)]: 50_000_000n, [("cc").repeat(32)]: 20_000_000n }[i.txId], 0n);
    assert.ok(body.outputs.length >= 1);
    for (const out of body.outputs) assert.equal(out.address, wallet.address);
    const paid = body.outputs.reduce((sum, o) => sum + o.value.coins, 0n);
    assert.equal(paid + body.fee, spent); // value conserved: only the fee leaves the wallet
    assert.equal(String(body.fee), result.fee);
    assert.ok(body.fee > 0n && body.fee < 500_000n);
    assert.equal(tx.witnessSet().vkeys().values().length, 1);
    assert.ok(result.estimatedSignedTxSize > result.cborHex.length / 2 - 1);
  });
});

test("anchor tx refuses a wallet with no UTxOs or only token-bearing UTxOs, submitting nothing", async (t) => {
  // Feature: the anchor never spends token UTxOs and tells the operator what funding is missing.
  // Failure: an empty or token-only wallet builds a tx anyway or fails with an opaque selector error.
  // Negative control: removing either guard changes the thrown message and fails the match.
  const wallet = await makeWallet();
  const cases = [
    ["no UTxOs", [], /has no UTxOs on preview/],
    ["only token UTxOs", [utxo("aa", 9_000_000, [{ unit: TOKEN_UNIT, quantity: "1" }])], /no clean \(no-token\) UTxOs/],
  ];
  for (const [name, utxos, message] of cases) {
    await t.test(name, async () => {
      await withBlockfrost(utxos, async (submitted) => {
        await assert.rejects(submitAnchorSelfTx({ network: "preview", wallet, blockfrostApiKey: "k" }), message);
        assert.equal(submitted.length, 0);
      });
    });
  }
});

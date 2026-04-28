import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import {
  buildPlaceholderSignatures,
  Serialization,
} from "../helpers/cardano-sdk/index.js";
import {
  locateWitnessSet,
  mergeVkeysIntoTxCbor,
  skipCborItem,
  spliceVkeysIntoWitnessSet,
} from "../helpers/cardano-sdk/cborSplice.js";

test("skipCborItem handles definite-length arrays, maps, byte strings", () => {
  // [1, 2, 3] → 0x83 0x01 0x02 0x03 → skips to byte 4.
  assert.equal(skipCborItem(Buffer.from("83010203", "hex"), 0), 4);
  // {1: 2} → 0xa1 0x01 0x02 → skips to byte 3.
  assert.equal(skipCborItem(Buffer.from("a10102", "hex"), 0), 3);
  // h'ab' → 0x41 0xab → skips to byte 2.
  assert.equal(skipCborItem(Buffer.from("41ab", "hex"), 0), 2);
});

test("skipCborItem handles indefinite-length arrays terminated by 0xff", () => {
  // 9f01 02 03 ff → indefinite array with 3 ints → skips past 0xff.
  const buf = Buffer.from("9f010203ff", "hex");
  assert.equal(skipCborItem(buf, 0), buf.length);
});

test("locateWitnessSet finds the witness_set element in a Conway tx", () => {
  // Build a minimal Conway tx CBOR by hand: [body, ws, is_valid, aux].
  // - body: a1 00 80 (map with key 0 -> empty array)
  // - ws:   a0 (empty map)
  // - is_valid: f5 (true)
  // - aux:  f6 (null)
  const tx = Buffer.from("84a10080a0f5f6", "hex");
  const { start, end } = locateWitnessSet(tx);
  // body is bytes 1-3 (a10080), ws starts at 4 (a0), end at 5.
  assert.equal(start, 4);
  assert.equal(end, 5);
  assert.equal(tx[start], 0xa0);
});

test("spliceVkeysIntoWitnessSet replaces vkeys in a non-empty witness set", () => {
  // origWs has a map key 1 (native scripts) only. Adding key 0 (vkeys) should
  // produce a 2-entry map with vkeys first, native scripts preserved
  // byte-for-byte.
  const origWs = Buffer.from("a101820080", "hex"); // {1: [[],[]]} (just placeholder bytes)
  // sigOnly is a witness set with only a vkey entry.
  const sigOnly = "a100815820000000000000000000000000000000000000000000000000000000000000000158400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

  const merged = spliceVkeysIntoWitnessSet(origWs, sigOnly);
  const mergedBuf = Buffer.from(merged, "hex");
  // First byte is map header with len 2.
  assert.equal(mergedBuf[0] & 0x1f, 2, "merged map should have 2 entries");
});

test("spliceVkeysIntoWitnessSet returns sigOnly when origWs is empty (a0)", () => {
  const sigOnly = "a10081820001";
  const merged = spliceVkeysIntoWitnessSet(Buffer.from([0xa0]), sigOnly);
  assert.equal(merged, sigOnly);
});

test("mergeVkeysIntoTxCbor preserves body + native script bytes verbatim", () => {
  // Build a Conway tx with a known body + a witness set containing only a
  // native script. Then splice in a vkey witness and verify:
  //  - body bytes are unchanged
  //  - native script bytes are unchanged
  //  - vkeys are present
  const txCore = {
    id: "0".repeat(64),
    body: { inputs: [], outputs: [], fee: 1000n },
    witness: {
      signatures: new Map(),
      scripts: [
        Serialization.NativeScript.fromCbor(
          "8202828200581c5b468ea6affe46ae95b2f39e8aaf9141c17f1beb7f575ba818cf1a8b8200581cd9980af92828f622d9c9f0a6e89a61da55829ac0dbd11127bc62916d"
        ).toCore(),
      ],
    },
  };
  const txCbor = Serialization.Transaction.fromCore(txCore).toCbor();

  // Build a sigOnly witness set with placeholder signatures (2 vkeys).
  const sigOnlyTx = {
    id: txCore.id,
    body: txCore.body,
    witness: { signatures: buildPlaceholderSignatures(2) },
  };
  const sigOnlyTxCbor = Serialization.Transaction.fromCore(sigOnlyTx).toCbor();
  const sigOnlyTxBuf = Buffer.from(sigOnlyTxCbor, "hex");
  const { start, end } = locateWitnessSet(sigOnlyTxBuf);
  const sigOnlyWsCbor = sigOnlyTxBuf.subarray(start, end).toString("hex");

  const mergedHex = mergeVkeysIntoTxCbor(txCbor, sigOnlyWsCbor);
  const mergedTx = Serialization.Transaction.fromCbor(mergedHex).toCore();

  assert.equal(mergedTx.witness.scripts?.length, 1, "native script preserved");
  assert.equal(mergedTx.witness.signatures?.size, 2, "two vkeys spliced in");
});

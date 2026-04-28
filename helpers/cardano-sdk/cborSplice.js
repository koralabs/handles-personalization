import { Buffer } from "node:buffer";

// CBOR byte-walker + witness-set splicer. Used to merge vkey signatures into
// a pre-built Plutus transaction without disturbing the original script /
// redeemer / datum bytes. The naive approach — decode the tx to Core, merge,
// re-encode — produces definite-length Plutus data CBOR that the Cardano node
// rejects with PPViewHashesDontMatch, because script_data_hash is computed
// over the *original* indefinite-length redeemer bytes.
//
// Ported from decentralized-minting/src/helpers/cardano-sdk/cborSplice.ts.

// Skip a single CBOR item starting at `start` and return the byte offset
// immediately after the item. Handles all major types and indefinite-length
// arrays/maps. Throws on the reserved additional-info values 28-30.
export const skipCborItem = (buf, start) => {
  const mt = buf[start] >> 5;
  const ai = buf[start] & 0x1f;
  let he = start + 1;
  let len = ai;
  if (ai === 24) {
    len = buf[start + 1];
    he = start + 2;
  } else if (ai === 25) {
    len = buf.readUInt16BE(start + 1);
    he = start + 3;
  } else if (ai === 26) {
    len = buf.readUInt32BE(start + 1);
    he = start + 5;
  } else if (ai === 27) {
    len = Number(buf.readBigUInt64BE(start + 1));
    he = start + 9;
  } else if (ai >= 28 && ai <= 30) {
    throw new Error("Unsupported CBOR additional info value");
  } else if (ai === 31) {
    let c = he;
    if (mt === 4 || mt === 5) {
      while (buf[c] !== 0xff) {
        c = skipCborItem(buf, c);
        if (mt === 5) c = skipCborItem(buf, c);
      }
      return c + 1;
    }
    while (buf[c] !== 0xff) c = skipCborItem(buf, c);
    return c + 1;
  }
  if (mt <= 1 || mt === 7) return he;
  if (mt === 2 || mt === 3) return he + len;
  if (mt === 6) return skipCborItem(buf, he); // tag: skip tagged item
  if (mt === 4) {
    let c = he;
    for (let i = 0; i < len; i += 1) c = skipCborItem(buf, c);
    return c;
  }
  if (mt === 5) {
    let c = he;
    for (let i = 0; i < len; i += 1) {
      c = skipCborItem(buf, c);
      c = skipCborItem(buf, c);
    }
    return c;
  }
  return he;
};

// Given a Conway `transaction = [body, witness_set, is_valid, aux]` CBOR
// array starting at byte 0 with the outer array marker, return the start and
// end offsets of the witness_set (element index 1).
export const locateWitnessSet = (txBytes) => {
  let off = 1;
  off = skipCborItem(txBytes, off);
  const start = off;
  const end = skipCborItem(txBytes, off);
  return { start, end };
};

// Splice a vkey-only witness_set (`sigOnlyCbor` — a map with one key=0 entry
// produced by Serialization.TransactionWitnessSet.fromCore) into the original
// witness_set bytes while preserving scripts / redeemers / datums
// byte-for-byte.
export const spliceVkeysIntoWitnessSet = (origWsBytes, sigOnlyCbor) => {
  if (origWsBytes.length === 1 && origWsBytes[0] === 0xa0) {
    return sigOnlyCbor;
  }
  const origMapLen = origWsBytes[0] & 0x1f;
  let wsOff = 1;
  const otherEntries = [];
  for (let i = 0; i < origMapLen; i += 1) {
    const entryStart = wsOff;
    const key = origWsBytes[wsOff] & 0x1f;
    wsOff += 1;
    wsOff = skipCborItem(origWsBytes, wsOff);
    if (key !== 0) otherEntries.push(origWsBytes.subarray(entryStart, wsOff));
  }
  const sigOnlyBuf = Buffer.from(sigOnlyCbor, "hex");
  const vkeyEntry = sigOnlyBuf.subarray(1); // skip the 'a1' map header
  const newMapLen = 1 + otherEntries.length;
  const mapHeader = Buffer.from([0xa0 | newMapLen]);
  return Buffer.concat([mapHeader, vkeyEntry, ...otherEntries]).toString("hex");
};

// Merge vkey signatures into an existing transaction CBOR hex, preserving the
// original witness_set bytes byte-for-byte (scripts, redeemers, datums).
export const mergeVkeysIntoTxCbor = (txCborHex, sigOnlyCborHex) => {
  const txBytes = Buffer.from(txCborHex, "hex");
  const { start, end } = locateWitnessSet(txBytes);
  const origWs = txBytes.subarray(start, end);
  const mergedWsHex = spliceVkeysIntoWitnessSet(origWs, sigOnlyCborHex);
  const prefix = txBytes.subarray(0, start).toString("hex");
  const suffix = txBytes.subarray(end).toString("hex");
  return prefix + mergedWsHex + suffix;
};

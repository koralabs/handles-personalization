import assert from "node:assert/strict";
import test from "node:test";
import cbor from "cbor";

import {
  LEGACY_PROXY_MIGRATION_HASH,
  patchSettings,
} from "../scripts/buildNamespaceCutover.js";

const hash = (byte) => Buffer.alloc(28, byte);
const datum = (fields = 9) => {
  const value = [1, hash(1), 2, new Map(), [hash(2)], [hash(3)], hash(4), 5, 6];
  if (fields === 10) value.push([hash(5)]);
  return Buffer.from(cbor.encode(value)).toString("hex");
};

test("namespace cutover preserves settings fields while authorizing every new contract", () => {
  // Invariant: the cutover may only extend valid_contracts and persdsg_hashes.
  // Failure mode: a settings migration silently changes fees, credentials, providers, or timing.
  const original = cbor.decodeFirstSync(Buffer.from(datum(10), "hex"));
  const patched = cbor.decodeFirstSync(
    Buffer.from(patchSettings(datum(10), [hash(6), hash(7)], hash(8)), "hex"),
  );

  for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) assert.deepEqual(patched[index], original[index]);
  assert.deepEqual(patched[4], [hash(2), hash(6), hash(7)]);
  assert.deepEqual(patched[9], [hash(5), hash(8)]);
});

test("namespace cutover can authorize the legacy proxy in canonical settings for migration", () => {
  // User-visible invariant: an LBL_100 at the frozen proxy can migrate through
  // the current perslfc observer after the namespace cutover.
  // Failure caught: canonical settings authorize only the destination proxy,
  // so perslfc rejects because its source-validator hash is not authorized.
  const currentProxy = hash(6);
  const patched = cbor.decodeFirstSync(
    Buffer.from(
      patchSettings(datum(10), [currentProxy, LEGACY_PROXY_MIGRATION_HASH], hash(8)),
      "hex",
    ),
  );

  assert.deepEqual(patched[4], [hash(2), currentProxy, LEGACY_PROXY_MIGRATION_HASH]);
  assert.notDeepEqual(patched[4], [hash(2), currentProxy]);
});

test("namespace cutover upgrades a legacy nine-field copy to the required ten-field schema", () => {
  // Invariant: canonical settings always expose persdsg_hashes at index 9.
  // Failure mode: namespaced perspz rejects every non-reset personalization at datum parsing.
  const patched = cbor.decodeFirstSync(
    Buffer.from(patchSettings(datum(9), [hash(6)], hash(8)), "hex"),
  );
  assert.equal(patched.length, 10);
  assert.deepEqual(patched[9], [hash(8)]);
});

test("namespace cutover rejects an invalid settings datum instead of manufacturing state", () => {
  // Invariant: only the known nine- or ten-field settings schema can be migrated.
  // Failure mode: malformed input is emitted as a signable multisig transaction.
  const malformed = Buffer.from(cbor.encode([1, 2, 3])).toString("hex");
  assert.throws(() => patchSettings(malformed, [hash(6)], hash(8)), /9- or 10-element/);
});

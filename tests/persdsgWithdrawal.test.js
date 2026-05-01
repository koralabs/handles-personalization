import assert from "node:assert/strict";
import test from "node:test";

import cbor from "cbor";

import {
    encodePersdsgObserverRedeemer,
    persdsgWithdrawalEntry,
    readPersdsgHashFromArtifacts,
    readPersdsgStakeAddressFromArtifacts,
} from "../persdsgWithdrawal.js";

// A throwaway perspz redeemer payload — CBOR for `Constr 0 [...]`. Mirrors
// the shape of `types.Redeemer.Personalize { handle, root_handle, indexes,
// designer, reset }`. The exact field values don't matter for these tests;
// what matters is that the builder round-trips the structure into the
// outer `Observe { … }` Constr without modification.
const samplePerspzRedeemerCbor = cbor.encode(
    new cbor.Tagged(121, ["fake redeemer payload"])
);

const sampleOwnRef = {
    txId: "0".repeat(64),
    outputIndex: 0,
};

test("encodePersdsgObserverRedeemer wraps own_ref + perspz redeemer in Constr 0", () => {
    // Feature: the persdsg observer-redeemer must structurally equal the
    // `Observe { own_ref, redeemer }` value that perspz's
    // persdsg_observed_for_personalize compares against (built via
    // `builtin.constr_data(0, [own_ref_data, redeemer_data])`).
    // Failure mode: a mis-encoded redeemer would fail perspz's check on-chain
    // even though everything else lines up; the BFF would build "valid-looking"
    // txs that get silently rejected at submission.
    const buf = encodePersdsgObserverRedeemer({
        ownRef: sampleOwnRef,
        perspzRedeemer: samplePerspzRedeemerCbor,
    });
    const decoded = cbor.decodeFirstSync(buf);

    // Outer Constr 0 (CBOR tag 121).
    assert.equal(decoded.tag, 121);
    assert.equal(decoded.value.length, 2);

    // First field: OutputReference (Constr 0 [tx_id, output_index]).
    const ownRefDecoded = decoded.value[0];
    assert.equal(ownRefDecoded.tag, 121);
    assert.equal(ownRefDecoded.value.length, 2);
    assert.equal(
        Buffer.from(ownRefDecoded.value[0]).toString("hex"),
        sampleOwnRef.txId
    );
    assert.equal(ownRefDecoded.value[1], sampleOwnRef.outputIndex);

    // Second field: the perspz redeemer, byte-identical to the input after
    // a round-trip through Plutus Data.
    const reEncoded = cbor.encode(decoded.value[1]);
    assert.deepEqual([...reEncoded], [...samplePerspzRedeemerCbor]);
});

test("encodePersdsgObserverRedeemer accepts hex-string redeemer", () => {
    // Convenience: BFF code may have the perspz redeemer in hex form.
    const bufFromBuffer = encodePersdsgObserverRedeemer({
        ownRef: sampleOwnRef,
        perspzRedeemer: samplePerspzRedeemerCbor,
    });
    const bufFromHex = encodePersdsgObserverRedeemer({
        ownRef: sampleOwnRef,
        perspzRedeemer: samplePerspzRedeemerCbor.toString("hex"),
    });
    assert.deepEqual([...bufFromBuffer], [...bufFromHex]);
});

test("encodePersdsgObserverRedeemer rejects malformed own_ref", () => {
    // Failure mode: silently producing a junk Constr would yield a tx that
    // perspz rejects on-chain after the BFF already submitted it.
    assert.throws(
        () =>
            encodePersdsgObserverRedeemer({
                ownRef: { txId: "deadbeef", outputIndex: 0 },
                perspzRedeemer: samplePerspzRedeemerCbor,
            }),
        /64-char hex/
    );
    assert.throws(
        () =>
            encodePersdsgObserverRedeemer({
                ownRef: { txId: "0".repeat(64), outputIndex: -1 },
                perspzRedeemer: samplePerspzRedeemerCbor,
            }),
        /non-negative integer/
    );
});

test("persdsgWithdrawalEntry returns credential hash + 0 lovelace + redeemer", () => {
    // Reads the on-disk persdsg hash via the contract artifact directory.
    const entry = persdsgWithdrawalEntry({
        ownRef: sampleOwnRef,
        perspzRedeemer: samplePerspzRedeemerCbor,
    });

    assert.equal(typeof entry.withdrawalCredentialHash, "string");
    assert.equal(entry.withdrawalCredentialHash.length, 56);
    assert.equal(entry.lovelace, 0);
    assert.ok(Buffer.isBuffer(entry.redeemerCbor));

    // Hash must match the on-disk artifact (compileAiken's source of truth).
    assert.equal(entry.withdrawalCredentialHash, readPersdsgHashFromArtifacts());
});

test("persdsgWithdrawalEntry validates hash override", () => {
    assert.throws(
        () =>
            persdsgWithdrawalEntry({
                ownRef: sampleOwnRef,
                perspzRedeemer: samplePerspzRedeemerCbor,
                persdsgHash: "abcd", // too short
            }),
        /56 hex chars/
    );
});

test("readPersdsgStakeAddressFromArtifacts returns valid bech32", () => {
    const testnet = readPersdsgStakeAddressFromArtifacts("testnet");
    const mainnet = readPersdsgStakeAddressFromArtifacts("mainnet");
    assert.ok(testnet.startsWith("stake_test1"));
    assert.ok(mainnet.startsWith("stake1"));
});

test("readPersdsgStakeAddressFromArtifacts rejects unknown network", () => {
    assert.throws(
        () => readPersdsgStakeAddressFromArtifacts("xyz"),
        /must be "mainnet" or "testnet"/
    );
});

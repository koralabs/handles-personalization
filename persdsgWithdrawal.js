// Off-chain helper for the `persdsg` (designer-settings observer) withdrawal
// entry that perspz requires for non-reset Personalize txs.
//
// On-chain rule (aiken/lib/personalization/update.ak::persdsg_observed_for_personalize):
// for non-reset (`reset != 0` is false) Personalize txs, perspz scans
// tx.redeemers for an entry where:
//   purpose       == Withdraw(Script(persdsg_hash))
//   redeemer_data == Observe { own_ref, redeemer }
// and verifies the corresponding entry in tx.withdrawals carries 0 lovelace.
// `own_ref` is the same OutputReference perspz is observing; `redeemer` is the
// same Personalize redeemer perspz is processing. By making the observer-
// redeemer payload identical, persdsg validates the same tx state perspz does.
//
// Reset-path Personalize txs do NOT need this withdrawal — perspz skips the
// persdsg check when reset=1 (Helios semantics: reset wipes the personalization,
// so designer_settings is irrelevant).
//
// Tx-builder integration (e.g. handle.me/bff Personalize-tx construction):
//   1. Build the existing perspz Withdraw 0 entry as today.
//   2. If the redeemer's `reset` field is 0, ALSO add a Withdraw 0 entry
//      built via `persdsgWithdrawalEntry({ ownRef, perspzRedeemerCbor })`.
//   3. Include the persdsg ref-script in tx.reference_inputs (the on-chain
//      ref-script published via scripts/deployContractRefScripts.js).

import cbor from "cbor";

import {
    getAikenArtifactPaths,
} from "./compileHelpers.js";
import { readFileSync } from "node:fs";

const PERSDSG_HASH_HEX_LENGTH = 56; // 28 bytes = 56 hex chars

/**
 * Read persdsg's script hash from the compileAiken artifact files.
 * Returns a 56-char hex string.
 *
 * @param {string} [contractDirectory] - Defaults to ./contract.
 * @returns {string} hex-encoded 28-byte script hash.
 */
export function readPersdsgHashFromArtifacts(contractDirectory) {
    const paths = getAikenArtifactPaths(contractDirectory ?? "./contract");
    const hash = readFileSync(paths.perValidator("persdsg").hash, "utf8").trim();
    if (hash.length !== PERSDSG_HASH_HEX_LENGTH) {
        throw new Error(
            `persdsg hash from ${paths.perValidator("persdsg").hash} is not 28 bytes (got ${hash.length / 2})`
        );
    }
    return hash;
}

/**
 * Read persdsg's bech32 stake address (the address Withdraw entries point at).
 *
 * @param {"mainnet"|"testnet"} network
 * @param {string} [contractDirectory]
 * @returns {string} bech32 stake address.
 */
export function readPersdsgStakeAddressFromArtifacts(network, contractDirectory) {
    if (network !== "mainnet" && network !== "testnet") {
        throw new Error(`network must be "mainnet" or "testnet", got ${network}`);
    }
    const paths = getAikenArtifactPaths(contractDirectory ?? "./contract");
    const file =
        network === "mainnet"
            ? paths.perValidator("persdsg").stakeAddrMainnet
            : paths.perValidator("persdsg").stakeAddrTestnet;
    return readFileSync(file, "utf8").trim();
}

/**
 * Encode the persdsg observer-redeemer for a given own_ref + perspz redeemer.
 * This is the CBOR payload that goes in `tx.redeemers` under the
 * Withdraw(persdsg_credential) purpose key. It must match what perspz computes
 * via `builtin.constr_data(0, [own_ref_data, redeemer_data])` in
 * persdsg_observed_for_personalize.
 *
 * @param {object} args
 * @param {{ txId: string, outputIndex: number }} args.ownRef - the spend
 *   OutputReference perspz is processing. txId is hex (64 chars / 32 bytes).
 * @param {Buffer|string} args.perspzRedeemer - the perspz redeemer payload
 *   (a `types.Redeemer.Personalize { … }` Constr) as CBOR. Either pass a
 *   Buffer of decoded CBOR or a hex string. Must be the SAME Data perspz's
 *   Withdraw entry carries.
 * @returns {Buffer} CBOR-encoded `Observe { own_ref, redeemer }` ready to drop
 *   into `tx.redeemers[Withdraw(persdsg_credential)]`.
 */
export function encodePersdsgObserverRedeemer({ ownRef, perspzRedeemer }) {
    if (!ownRef || typeof ownRef.txId !== "string" || ownRef.txId.length !== 64) {
        throw new Error(
            "ownRef.txId must be a 64-char hex string (32-byte transaction id)"
        );
    }
    if (!Number.isInteger(ownRef.outputIndex) || ownRef.outputIndex < 0) {
        throw new Error("ownRef.outputIndex must be a non-negative integer");
    }

    // OutputReference is `Constr 0 [bytestring tx_id, int output_index]`.
    const ownRefData = new cbor.Tagged(121, [
        Buffer.from(ownRef.txId, "hex"),
        ownRef.outputIndex,
    ]);

    // Perspz redeemer must arrive as already-encoded CBOR. We decode it just
    // long enough to embed it as a Plutus Data sub-term.
    const perspzRedeemerBuffer = Buffer.isBuffer(perspzRedeemer)
        ? perspzRedeemer
        : Buffer.from(perspzRedeemer, "hex");
    const perspzRedeemerData = cbor.decodeFirstSync(perspzRedeemerBuffer);

    // ObserverRedeemer is `Constr 0 [own_ref, redeemer]` (Plutus Constr index
    // 0 → CBOR tag 121).
    const observerData = new cbor.Tagged(121, [ownRefData, perspzRedeemerData]);
    return cbor.encode(observerData);
}

/**
 * Construct the full persdsg withdrawal entry the BFF must add to non-reset
 * Personalize txs. Returns the credential, the encoded observer-redeemer, and
 * the lovelace amount (always 0 — observer pattern requires Withdraw 0).
 *
 * The BFF should:
 *   1. Add `withdrawalCredentialHash` (Script-credential) → `lovelace` (=0) to tx.withdrawals.
 *   2. Add `(Withdraw, withdrawalCredentialHash)` → `redeemerCbor` to tx.redeemers.
 *   3. Include the persdsg ref-script in tx.reference_inputs.
 *
 * @param {object} args
 * @param {{ txId: string, outputIndex: number }} args.ownRef
 * @param {Buffer|string} args.perspzRedeemer
 * @param {string} [args.persdsgHash] - 56-char hex; defaults to reading from
 *   ./contract/aiken.persdsg.hash via readPersdsgHashFromArtifacts().
 * @returns {{ withdrawalCredentialHash: string, lovelace: number, redeemerCbor: Buffer }}
 */
export function persdsgWithdrawalEntry({ ownRef, perspzRedeemer, persdsgHash }) {
    const hash = persdsgHash ?? readPersdsgHashFromArtifacts();
    if (hash.length !== PERSDSG_HASH_HEX_LENGTH) {
        throw new Error(
            `persdsgHash must be 56 hex chars (28 bytes); got ${hash.length}`
        );
    }
    const redeemerCbor = encodePersdsgObserverRedeemer({ ownRef, perspzRedeemer });
    return {
        withdrawalCredentialHash: hash,
        lovelace: 0,
        redeemerCbor,
    };
}

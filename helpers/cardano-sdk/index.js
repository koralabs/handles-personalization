import "./conwayEra.js";

import { Cardano, Serialization } from "@cardano-sdk/core";

export { Cardano, Serialization };

export const asPaymentAddress = (address) => address;

export const buildPlaceholderSignatures = (signerCount) => {
  const signatures = new Map();
  for (let index = 0; index < signerCount; index += 1) {
    const publicKey = `${index + 1}`.padStart(64, "0");
    const signature = `${index + 1}`.padStart(128, "0");
    signatures.set(publicKey, signature);
  }
  return signatures;
};

export const transactionToCbor = (tx) =>
  Serialization.Transaction.fromCore(tx).toCbor();

export const transactionHashFromCore = (tx) =>
  Serialization.TransactionBody.fromCore(structuredClone(tx.body)).hash();

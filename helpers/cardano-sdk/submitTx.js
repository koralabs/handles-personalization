import { Buffer } from "node:buffer";

const blockfrostHost = (network) => `https://cardano-${network}.blockfrost.io/api/v0`;

// Submits a fully signed Conway tx CBOR via Blockfrost's
// /tx/submit endpoint. Returns the tx hash on success.
export const submitTx = async ({ network, signedTxCborHex, blockfrostApiKey, fetchFn = fetch }) => {
  if (!network) throw new Error("submitTx: network is required");
  if (!signedTxCborHex) throw new Error("submitTx: signedTxCborHex is required");
  if (!blockfrostApiKey) throw new Error("submitTx: blockfrostApiKey is required");

  const stripped = signedTxCborHex.startsWith("0x") ? signedTxCborHex.slice(2) : signedTxCborHex;
  const body = Buffer.from(stripped, "hex");

  const response = await fetchFn(`${blockfrostHost(network)}/tx/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/cbor",
      project_id: blockfrostApiKey,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`Blockfrost /tx/submit failed: HTTP ${response.status} — ${text}`);
  }

  // Blockfrost returns the tx hash as a quoted JSON string.
  const txHash = (await response.text()).trim().replace(/^"|"$/g, "");
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    throw new Error(`Blockfrost /tx/submit returned unexpected body: ${txHash}`);
  }
  return txHash;
};

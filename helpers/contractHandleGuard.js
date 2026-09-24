import { Buffer } from "node:buffer";

import { bech32 } from "bech32";

// Count UTxOs holding anything besides ADA under `scriptHash`'s payment credential (every stake
// variant). Handles locked under a contract version keep needing that version's reference script.
export const countAssetUtxosAtScript = async ({ scriptHash, network, blockfrostApiKey, fetchFn = fetch }) => {
  const credential = bech32.encode("script", bech32.toWords(Buffer.from(scriptHash, "hex")));
  const host = `https://cardano-${network}.blockfrost.io/api/v0`;
  let count = 0;
  for (let page = 1; ; page++) {
    const response = await fetchFn(`${host}/addresses/${credential}/utxos?count=100&page=${page}`, {
      headers: { "Content-Type": "application/json", project_id: blockfrostApiKey },
    });
    if (response.status === 404) return count;
    if (!response.ok) throw new Error(`Blockfrost credential UTxO fetch for ${credential}: HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) return count;
    count += items.filter((item) => item.amount.some((a) => a.unit !== "lovelace")).length;
    if (items.length < 100) return count;
  }
};

// A contract handle may be reused for new script bytes only when nothing is locked under the script
// it currently carries. Otherwise that version drops out of the /scripts registry and every handle
// locked there loses its resolvable reference script (mainnet persprx1, 2026-09-10: 281 LBL_100s).
export const assertContractHandleReplaceable = async ({ handleName, currentScriptHash, nextScriptHash, network, blockfrostApiKey }) => {
  if (!currentScriptHash || currentScriptHash === nextScriptHash) return;
  const locked = await countAssetUtxosAtScript({ scriptHash: currentScriptHash, network, blockfrostApiKey });
  if (locked > 0) {
    throw new Error(
      `refusing to replace ${handleName}'s reference script ${currentScriptHash}: ${locked} asset UTxO(s) are still locked under it. ` +
      "Deploy the new script to the next <slug><ordinal>@handlecontract (see adahandle-deployments/common/discover_subhandles.py) instead."
    );
  }
};

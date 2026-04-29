#!/usr/bin/env node
// One-off fixture-creation script: mint a CIP-68 v1 background NFT on
// preview with a fully-loaded creator-defaults datum so the e2e CIP-30
// suite can exercise every branch of the personalization validator.
//
// What this does:
//   1. Derives a fresh native-script policy from the e2e wallet's payment
//      key. Policy_id = blake2b-224(serialized native_script). NOT a Kora
//      handles policy — distinct fixture-only policy.
//   2. Mints two assets at that policy in a single tx:
//        - LBL_001 user-held token  (handles_bg_boat_full)
//        - LBL_100 reference NFT carrying the inline datum with metadata
//          (CIP-68 v1: { name, image }) + creator-defaults extra map
//      Both go to the e2e wallet so scope 03 can pick them up.
//   3. Submits via Blockfrost.
//
// After this:
//   - addPolicyToPartners.js inserts a row in partners_preview
//   - syncBgRootOnChain.js pushes the new bg_root datum to
//     pers_bg@handle_settings via the deployer wallet (derivation 12)
//   - liveTxRunner.manifest.fresh.json scope 03 fixture is updated to
//     reference the new bg_asset

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import bip39 from "bip39";
import cbor from "cbor";
import sodium from "libsodium-wrappers-sumo";

import { Bip32PrivateKey } from "@cardano-sdk/crypto";

import {
  Cardano,
  Serialization,
} from "../helpers/cardano-sdk/index.js";
import { submitTx } from "../helpers/cardano-sdk/submitTx.js";

const NETWORK = "preview";
const HARDENED = 0x80000000;

const LBL_001 = "001bc280"; // user-held bg label (matches handles_bg_boat_2 fixture)
const LBL_100 = "000643b0"; // CIP-68 ref NFT label

const BG_NAME = "handles_bg_boat_full";
const BG_IMAGE = "ipfs://QmSkgqaCapgw99Y2oAZ72tj9iGRb89DzM7kJPetvsj7NND"; // boat_2 image

// The e2e wallet holds a stack of `e2e0*@` Kora handles. Use them as the
// require_asset_collections target so the asset-gate validator branch is
// exercised but the wallet trivially satisfies it.
const KORA_PREVIEW_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const LBL_222 = "000de140";
const E2E_PREFIX_UTF8_HEX = Buffer.from("e2e0", "utf8").toString("hex");

const loadEnv = (path) => {
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
};

const deriveE2eWallet = async (mnemonic, networkId) => {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = await Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy, "hex"), "");
  const account = root.derive([1852 + HARDENED, 1815 + HARDENED, 0 + HARDENED]);
  const paymentKey = (await account.derive([0, 0])).toRawKey();
  const stakeKey = (await account.derive([2, 0])).toRawKey();
  const paymentPub = await paymentKey.toPublic();
  const stakePub = await stakeKey.toPublic();
  const paymentKeyHashHex = (await paymentPub.hash()).hex();
  const stakeKeyHashHex = (await stakePub.hash()).hex();
  const address = Cardano.BaseAddress.fromCredentials(
    networkId,
    { type: Cardano.CredentialType.KeyHash, hash: paymentKeyHashHex },
    { type: Cardano.CredentialType.KeyHash, hash: stakeKeyHashHex }
  )
    .toAddress()
    .toBech32();
  return {
    paymentKey,
    paymentPub,
    paymentKeyHashHex,
    stakeKey,
    stakeKeyHashHex,
    address,
  };
};

const buildNativeScript = (paymentKeyHashHex) => {
  const scriptCore = {
    __type: Cardano.ScriptType.Native,
    kind: Cardano.NativeScriptKind.RequireSignature,
    keyHash: paymentKeyHashHex,
  };
  const native = Serialization.NativeScript.fromCore(scriptCore);
  const policyId = native.hash();
  return { native, scriptCore, policyId };
};

// CBOR-encode the CIP-68 v1 datum as Constr 0 [metadata_map, version, Constr 0 [extra_map]]
// using `cbor`'s Tagged class (tag 121 = Plutus Constr alt 0). Map keys/values are byte strings,
// matching the validator's `defaults.get_safe(<key_str>)` lookups.
const buildInlineDatumHex = ({ extraMap }) => {
  const metadata = new Map([
    [Buffer.from("name", "utf8"), Buffer.from(BG_NAME, "utf8")],
    [Buffer.from("image", "utf8"), Buffer.from(BG_IMAGE, "utf8")],
  ]);
  const datum = new cbor.Tagged(121, [
    metadata,
    1, // CIP-68 v1
    new cbor.Tagged(121, [extraMap]),
  ]);
  return cbor.encode(datum).toString("hex");
};

// Full creator-defaults map exercising every branch the validator inspects.
// Keys are byte strings (matches Helios `defaults.get_safe("...")`).
const buildExtraMap = () => {
  const k = (s) => Buffer.from(s, "utf8");
  const colorsHex = (arr) => arr.map((h) => Buffer.from(h, "hex"));

  // Multi-color arrays = "user picks" path; single-element array = "locked" path.
  return new Map([
    [k("bg_border_colors"), colorsHex(["0a1fd3ff", "22d1af88", "31bc2399"])],
    [k("bg_colors"), colorsHex(["ff0000ff", "00ff00ff", "0000ffff"])],
    [k("circuit_colors"), colorsHex(["ffaa00ff", "00aaffff", "aa00ffff"])],
    [k("pfp_border_colors"), colorsHex(["12546294"])], // single = locked
    [k("font_shadow_colors"), colorsHex(["0a1fd3", "22d1af", "31bc23"])],
    [k("text_ribbon_colors"), colorsHex(["000000ff", "12546294"])],

    // simp_equal_props
    [k("qr_bg_color"), Buffer.from("000000ff", "hex")],
    [k("socials_color"), Buffer.from("aa00aaff", "hex")],

    // simp_excl_props (E*)
    [k("text_ribbon_gradient"), Buffer.from("radial", "utf8")],
    [k("font_color"), Buffer.from("ff6130", "hex")],
    [k("font"), Buffer.from("TestFont,https://example.com/font.woff", "utf8")],
    [k("qr_image"), Buffer.from("https://example.com/qr.svg", "utf8")],

    // qr_props (E*)
    [k("qr_inner_eye"), Buffer.from("rounded,#aabbcc", "utf8")],
    [k("qr_outer_eye"), Buffer.from("square,#ddeeff", "utf8")],
    [k("qr_dot"), Buffer.from("dots,#112233", "utf8")],

    // Special-cased — exercise the bounds checks
    [k("font_shadow_size"), [12, 10, 8]],
    [k("pfp_zoom"), 130],
    [k("pfp_offset"), [10, 5]],

    // The locked-creator path
    [k("force_creator_settings"), 1],

    // Asset-gating: require any e2e* Kora handle. Wallet has 450 of these.
    [k("require_asset_collections"), [Buffer.from(KORA_PREVIEW_POLICY + LBL_222 + E2E_PREFIX_UTF8_HEX, "hex")]],
    [k("require_asset_displayed"), 0],

    // Misc display fields
    [k("custom_dollar_symbol"), 1],
    [k("price"), 100],
  ]);
};

const fetchUtxosBlockfrost = async (address, blockfrostApiKey, network) => {
  const allUtxos = [];
  let page = 1;
  while (true) {
    const url = `https://cardano-${network}.blockfrost.io/api/v0/addresses/${address}/utxos?order=desc&count=100&page=${page}`;
    const r = await fetch(url, { headers: { project_id: blockfrostApiKey } });
    if (!r.ok) {
      if (r.status === 404) break;
      throw new Error(`Blockfrost utxos page ${page}: HTTP ${r.status}`);
    }
    const items = await r.json();
    if (items.length === 0) break;
    allUtxos.push(...items);
    if (items.length < 100) break;
    page += 1;
  }
  return allUtxos;
};

const fetchTip = async (blockfrostApiKey, network) => {
  const r = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/blocks/latest`, {
    headers: { project_id: blockfrostApiKey },
  });
  if (!r.ok) throw new Error(`Blockfrost tip: HTTP ${r.status}`);
  return r.json();
};

const fetchProtocolParams = async (blockfrostApiKey, network) => {
  const r = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/epochs/latest/parameters`, {
    headers: { project_id: blockfrostApiKey },
  });
  if (!r.ok) throw new Error(`Blockfrost params: HTTP ${r.status}`);
  return r.json();
};

const buildAndSubmit = async () => {
  await sodium.ready;
  const env = loadEnv("/home/jesse/src/koralabs/handle.me/bff/.env.preview.local");
  const mnemonic = env.E2E_LIVE_WALLET_MNEMONIC;
  const expectedAddress = env.E2E_LIVE_WALLET_ADDRESS;
  if (!mnemonic) throw new Error("E2E_LIVE_WALLET_MNEMONIC missing");
  if (!expectedAddress) throw new Error("E2E_LIVE_WALLET_ADDRESS missing");

  const minting = loadEnv("/home/jesse/src/koralabs/minting.handle.me/.env");
  const blockfrostApiKey = minting.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) throw new Error("BLOCKFROST_API_KEY missing in minting.handle.me/.env");

  const networkId = 0; // preview

  const wallet = await deriveE2eWallet(mnemonic, networkId);
  if (wallet.address !== expectedAddress) {
    throw new Error(`derived address ${wallet.address} does not match expected ${expectedAddress}`);
  }
  console.log("e2e wallet:", wallet.address);
  console.log("payment key hash:", wallet.paymentKeyHashHex);

  const { native, policyId } = buildNativeScript(wallet.paymentKeyHashHex);
  console.log("native script policy_id:", policyId);

  const userAssetNameHex = LBL_001 + Buffer.from(BG_NAME, "utf8").toString("hex");
  const refAssetNameHex = LBL_100 + Buffer.from(BG_NAME, "utf8").toString("hex");
  const userAssetId = Cardano.AssetId.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(userAssetNameHex));
  const refAssetId = Cardano.AssetId.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(refAssetNameHex));

  const extraMap = buildExtraMap();
  const inlineDatumHex = buildInlineDatumHex({ extraMap });
  console.log("inline datum (", inlineDatumHex.length / 2, " bytes):", inlineDatumHex.slice(0, 80), "...");

  const utxos = await fetchUtxosBlockfrost(wallet.address, blockfrostApiKey, NETWORK);
  console.log("wallet utxos:", utxos.length);
  // Pick the largest ada-only utxo (>= 5 ADA) for fee + min-utxo coverage.
  const adaOnly = utxos
    .filter((u) => u.amount.length === 1 && u.amount[0].unit === "lovelace")
    .map((u) => ({ ...u, lovelace: BigInt(u.amount[0].quantity) }))
    .sort((a, b) => Number(b.lovelace - a.lovelace));
  if (adaOnly.length === 0) throw new Error("no ada-only UTxOs at e2e wallet");
  const input = adaOnly[0];
  if (input.lovelace < 5_000_000n) throw new Error(`input UTxO too small: ${input.lovelace} lovelace`);
  console.log("input utxo:", input.tx_hash + "#" + input.tx_index, "lovelace:", input.lovelace.toString());

  const tip = await fetchTip(blockfrostApiKey, NETWORK);
  const params = await fetchProtocolParams(blockfrostApiKey, NETWORK);
  const invalidHereafter = tip.slot + 7200; // 2 hours

  const walletPaymentAddr = Cardano.Address.fromBech32(wallet.address);
  // Min-UTxO grows with output size; the ref-NFT carries a ~700-byte inline
  // datum so it needs ~4.3 ADA per Conway protocol params. Use 5 ADA for the
  // ref output and 1.5 ADA for the user token output.
  const userOutputCoins = 1_500_000n;
  const refOutputCoins = 5_000_000n;
  const userTokenOutput = {
    address: wallet.address,
    value: { coins: userOutputCoins, assets: new Map([[userAssetId, 1n]]) },
  };
  const refTokenOutput = {
    address: wallet.address,
    value: { coins: refOutputCoins, assets: new Map([[refAssetId, 1n]]) },
    datum: Serialization.PlutusData.fromCbor(inlineDatumHex).toCore(),
  };

  // Estimate fee. Conservative: 0.5 ADA. If too low, refine.
  const estimatedFee = 500_000n;
  const changeLovelace = input.lovelace - userOutputCoins - refOutputCoins - estimatedFee;
  if (changeLovelace < 1_000_000n) throw new Error(`change too low: ${changeLovelace}`);
  const changeOutput = {
    address: wallet.address,
    value: { coins: changeLovelace, assets: new Map() },
  };

  const txBody = {
    inputs: [{ txId: Cardano.TransactionId(input.tx_hash), index: input.tx_index }],
    outputs: [userTokenOutput, refTokenOutput, changeOutput],
    fee: estimatedFee,
    validityInterval: { invalidBefore: undefined, invalidHereafter: invalidHereafter },
    mint: new Map([
      [
        Cardano.AssetId.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(userAssetNameHex)),
        1n,
      ],
      [
        Cardano.AssetId.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(refAssetNameHex)),
        1n,
      ],
    ]),
  };

  // Build serialized tx body to compute its real size, recompute fee, rebuild.
  const txCore = {
    body: txBody,
    witness: {
      signatures: new Map([
        [
          Buffer.from("00".repeat(32), "hex").toString("hex"), // placeholder pub key
          Buffer.from("00".repeat(64), "hex").toString("hex"), // placeholder sig
        ],
      ]),
      scripts: [{ __type: Cardano.ScriptType.Native, ...buildNativeScript(wallet.paymentKeyHashHex).scriptCore }],
    },
  };

  // First pass: serialize with placeholder, measure size, compute fee.
  const tx0 = Serialization.Transaction.fromCore(txCore);
  const txSize = tx0.toCbor().length / 2;
  const minFee =
    BigInt(params.min_fee_a) * BigInt(txSize) + BigInt(params.min_fee_b) + 50_000n; // padding
  const newChange = input.lovelace - userOutputCoins - refOutputCoins - minFee;
  if (newChange < 1_000_000n) throw new Error(`recomputed change too low: ${newChange} (fee ${minFee})`);
  txBody.fee = minFee;
  txBody.outputs[2].value.coins = newChange;

  const txFinal = Serialization.Transaction.fromCore(txCore);
  const bodyHash = Serialization.TransactionBody.fromCore(structuredClone(txCore.body)).hash();
  console.log("tx body hash:", bodyHash);
  console.log("tx size:", txSize, "fee:", minFee.toString(), "change:", newChange.toString());

  // Sign body hash
  const sig = await wallet.paymentKey.sign(Buffer.from(bodyHash, "hex"));
  const sigHex = sig.hex();
  const pubHex = (await wallet.paymentPub.hex());

  // Replace placeholder witness with real signature
  txCore.witness.signatures = new Map([[pubHex, sigHex]]);
  const signedTx = Serialization.Transaction.fromCore(txCore);
  const signedTxCborHex = signedTx.toCbor();

  console.log("signed tx CBOR length:", signedTxCborHex.length / 2);

  // Submit
  const txHash = await submitTx({ network: NETWORK, signedTxCborHex, blockfrostApiKey });
  console.log("submitted txHash:", txHash);

  console.log("\n===");
  console.log("policy_id:", policyId);
  console.log("user_asset (LBL_001 + name):", userAssetNameHex);
  console.log("ref_asset  (LBL_100 + name):", refAssetNameHex);
  console.log("tx:        ", txHash);
  console.log("===");
};

buildAndSubmit().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
//
// Register the 3 PZ V3 observer script-credentials as stake credentials so
// the spend handler's withdraw-zero observer pattern works on chain.
//
// V3 splits PZ logic into a thin spend proxy (persprx) plus three withdraw
// observers (perspz, perslfc, persdsg). The personalize spend tx adds a
// withdrawal of 0 lovelace from each fired observer's reward account; the
// chain re-runs the observer's script over the withdrawal redeemer. For the
// withdrawal to be valid, the script credential must be in the rewards
// state — i.e., previously registered via a stake-registration certificate.
//
// V2 helios pers6 didn't use observers (all logic was in-line in the spend
// script), so this registration step wasn't needed before. It was missed
// in the V3 deploy; this script catches up.
//
// Usage:
//   node scripts/registerObserverCredentials.js --network preview
//
// Reads BLOCKFROST_API_KEY from minting.handle.me/.env, mnemonic from
// handle.me/static/.env.local, and the V3 hashes from the local
// aiken/plutus.json (must match what's deployed). Submits via Blockfrost.

import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

import { roundRobinRandomImprove } from '@cardano-sdk/input-selection';
import {
    computeMinimumCoinQuantity,
    createTransactionInternals,
    defaultSelectionConstraints,
    GreedyTxEvaluator
} from '@cardano-sdk/tx-construction';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import * as bip39 from 'bip39';
import sodium from 'libsodium-wrappers-sumo';

import {
    asPaymentAddress,
    buildPlaceholderSignatures,
    Cardano,
    Serialization,
    transactionHashFromCore,
    transactionToCbor
} from '../helpers/cardano-sdk/index.js';
import { getBlockfrostBuildContext } from '../helpers/cardano-sdk/blockfrostContext.js';
import { fetchBlockfrostUtxos } from '../helpers/cardano-sdk/blockfrostUtxo.js';
import { submitTx } from '../helpers/cardano-sdk/submitTx.js';

const HARDENED = 0x80000000;

const PLUTUS_JSON = '/home/jesse/src/koralabs/handles-personalization/aiken/plutus.json';

const computeV3Hash = async (cborHex) => {
    await sodium.ready;
    const tagged = Buffer.concat([Buffer.from([0x03]), Buffer.from(cborHex, 'hex')]);
    return Buffer.from(sodium.crypto_generichash(28, tagged)).toString('hex');
};

const loadEnvFromFile = (path) => {
    try {
        const raw = readFileSync(path, 'utf8');
        const env = {};
        for (const line of raw.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
        return env;
    } catch {
        return {};
    }
};

const parseArgs = (argv) => {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const t = argv[i];
        if (!t.startsWith('--')) continue;
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            args[t.slice(2)] = next;
            i += 1;
        } else {
            args[t.slice(2)] = 'true';
        }
    }
    return args;
};

const deriveE2eWallet = async (mnemonic, networkId) => {
    const entropy = bip39.mnemonicToEntropy(mnemonic);
    const root = await Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy, 'hex'), '');
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
    return { paymentKey, paymentKeyHashHex, address };
};

const main = async () => {
    await sodium.ready;
    const args = parseArgs(process.argv.slice(2));
    const network = (args.network || '').trim().toLowerCase();
    if (!['preview', 'preprod'].includes(network)) {
        throw new Error('usage: --network <preview|preprod>');
    }

    const minting = loadEnvFromFile('/home/jesse/src/koralabs/minting.handle.me/.env');
    const handlemeStatic = loadEnvFromFile('/home/jesse/src/koralabs/handle.me/static/.env.local');
    const blockfrostApiKey = minting.BLOCKFROST_API_KEY || process.env.BLOCKFROST_API_KEY;
    const mnemonic = handlemeStatic.E2E_LIVE_WALLET_MNEMONIC || process.env.E2E_LIVE_WALLET_MNEMONIC;
    if (!blockfrostApiKey) throw new Error('BLOCKFROST_API_KEY is required');
    if (!mnemonic) throw new Error('E2E_LIVE_WALLET_MNEMONIC is required');

    const networkId = 0;

    // 1. Compute V3 observer hashes from local plutus.json
    const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, 'utf8'));
    const find = (title) => {
        const v = blueprint.validators.find((v) => v.title === title);
        if (!v) throw new Error(`validator ${title} not found in plutus.json`);
        return v.compiledCode;
    };
    const perspzHash = await computeV3Hash(find('perspz.perspz.withdraw'));
    const perslfcHash = await computeV3Hash(find('perslfc.perslfc.withdraw'));
    const persdsgHash = await computeV3Hash(find('persdsg.persdsg.withdraw'));
    const observers = [
        { name: 'perspz', hash: perspzHash },
        { name: 'perslfc', hash: perslfcHash },
        { name: 'persdsg', hash: persdsgHash }
    ];
    console.log('V3 observer hashes:');
    for (const o of observers) console.log(`  ${o.name}: ${o.hash}`);

    // 2. Set up wallet + chain context
    const e2e = await deriveE2eWallet(mnemonic, networkId);
    console.log(`Wallet: ${e2e.address}`);

    const buildContext = await getBlockfrostBuildContext(network, blockfrostApiKey);
    const stakeKeyDeposit = BigInt(buildContext.protocolParameters.stakeKeyDeposit ?? 2_000_000);
    console.log(`Stake key deposit: ${stakeKeyDeposit} lovelace each`);

    // 3. Filter out already-registered credentials. Conway's `Registration`
    //    cert fails if the credential is already registered.
    const checkRegistered = async (scriptHash) => {
        // Encode reward address: header type 0xf0 (script-key, testnet network 0)
        const rewardAddr = Cardano.RewardAddress.fromCredentials(networkId, {
            hash: scriptHash,
            type: Cardano.CredentialType.ScriptHash
        }).toAddress().toBech32();
        try {
            const r = await fetch(
                `https://cardano-${network}.blockfrost.io/api/v0/accounts/${rewardAddr}`,
                { headers: { project_id: blockfrostApiKey } }
            );
            if (!r.ok) return false;
            const j = await r.json();
            return j.active === true;
        } catch {
            return false;
        }
    };
    const toRegister = [];
    for (const o of observers) {
        const already = await checkRegistered(o.hash);
        if (already) {
            console.log(`  ${o.name} (${o.hash}): already registered — skipping`);
        } else {
            toRegister.push(o);
        }
    }
    if (toRegister.length === 0) {
        console.log('All 3 observer credentials already registered. Nothing to do.');
        return;
    }
    console.log(`Registering ${toRegister.length} credentials...`);

    // 4. Build certificates AND cert-purpose redeemers + reference inputs.
    //    Conway requires script approval for cert purposes — the chain runs
    //    each observer's `publish` handler over a redeemer (any data) when
    //    the cert is RegistrationCertificate. Without redeemers + the script
    //    in the witness set (or via reference inputs), submission fails with
    //    `MissingScriptWitnessesUTXOW`. The publish handler returns True
    //    unconditionally so the redeemer payload doesn't matter.
    const certificates = toRegister.map((o) => ({
        __typename: 'RegistrationCertificate',
        stakeCredential: {
            hash: o.hash,
            type: Cardano.CredentialType.ScriptHash
        },
        deposit: stakeKeyDeposit
    }));

    // Resolve each observer's deployed ref-script UTxO directly from chain
    // (Blockfrost). We could go through api.handle.me/scripts but that
    // depends on the api scanner indexing the redeploy; this is a deploy
    // script and shouldn't be gated by api lag. The asset's transactions
    // endpoint walks the LBL_222 token's history newest-first; the latest
    // unconsumed output is the live ref-script UTxO.
    const handleByObserver = {
        perspz: 'perspz1@handlecontract',
        perslfc: 'perslfc1@handlecontract',
        persdsg: 'persdsg1@handlecontract'
    };
    const HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
    const LBL_222 = '000de140';
    const findRefScriptUtxo = async (observerName, expectedHash) => {
        const handleHex = Buffer.from(handleByObserver[observerName], 'utf8').toString('hex');
        const assetUnit = `${HANDLE_POLICY}${LBL_222}${handleHex}`;
        const txsRes = await fetch(
            `https://cardano-${network}.blockfrost.io/api/v0/assets/${assetUnit}/transactions?order=desc&count=10`,
            { headers: { project_id: blockfrostApiKey } }
        );
        if (!txsRes.ok) throw new Error(`/assets/${assetUnit}/transactions: HTTP ${txsRes.status}`);
        const txs = await txsRes.json();
        for (const tx of txs) {
            const utxosRes = await fetch(
                `https://cardano-${network}.blockfrost.io/api/v0/txs/${tx.tx_hash}/utxos`,
                { headers: { project_id: blockfrostApiKey } }
            );
            if (!utxosRes.ok) continue;
            const utxosData = await utxosRes.json();
            for (const o of utxosData.outputs ?? []) {
                if (o.consumed_by_tx) continue;
                if (!(o.amount ?? []).some((a) => a.unit === assetUnit && BigInt(a.quantity) >= 1n)) continue;
                if (o.reference_script_hash !== expectedHash) continue;
                return { refScriptUtxo: `${tx.tx_hash}#${o.output_index}` };
            }
        }
        throw new Error(`no on-chain ref-script for ${observerName} (${expectedHash}); did the deploy land?`);
    };

    const referenceInputs = [];
    const certRedeemers = [];
    for (let i = 0; i < toRegister.length; i += 1) {
        const o = toRegister[i];
        const ref = await findRefScriptUtxo(o.name, o.hash);
        const [txId, idxStr] = ref.refScriptUtxo.split('#');
        referenceInputs.push({ txId: Cardano.TransactionId(txId), index: Number.parseInt(idxStr, 10) });
        // Redeemer: any data, since publish accepts unconditionally.
        // Use the empty Constr 0 (`d87980`).
        certRedeemers.push({
            purpose: Cardano.RedeemerPurpose.certificate,
            index: i,
            data: Serialization.PlutusData.fromCbor('d87980').toCore(),
            // Match the old (working) registration tx ex-units almost exactly;
            // publish returns True so actual usage is tiny.
            executionUnits: { memory: 1_000_000, steps: 200_000_000 }
        });
    }

    // 5. Build the tx
    const utxos = await fetchBlockfrostUtxos(e2e.address, blockfrostApiKey, network);
    const cleanUtxos = utxos
        .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
        .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n)));
    if (cleanUtxos.length === 0) throw new Error('e2e wallet has no clean UTxOs');

    const inputSelector = roundRobinRandomImprove({
        changeAddressResolver: {
            resolve: async (selection) =>
                selection.change.map((change) => ({ ...change, address: asPaymentAddress(e2e.address) }))
        }
    });
    const txEvaluator = new GreedyTxEvaluator(async () => buildContext.protocolParameters);
    const refInputsSet = new Set(referenceInputs);

    // Pick a clean ada-only UTxO ≥ 5 ADA for collateral. Plutus script
    // execution (the publish handler invocation that approves each cert)
    // requires a collateral input.
    // Conway bills collateral at fee × 1.5 (collateralPercentage 150). With
    // 3 cert-script invocations the required collateral is ~7.8 ADA, so
    // pick an ada-only UTxO ≥ 10 ADA with a cushion for fee jitter.
    const collateralUtxo = cleanUtxos.find((u) => (u[1].value.coins ?? 0n) >= 10_000_000n);
    if (!collateralUtxo) throw new Error('no clean ada-only UTxO ≥ 10 ADA for collateral');
    const collateralIn = { txId: collateralUtxo[0].txId, index: collateralUtxo[0].index };
    const requiredSigners = [e2e.paymentKeyHashHex];

    // Compute implicit-coin from cert deposits via the protocol-params helper.
    // Older cardano-sdk APIs accepted `implicitValue.deposit` directly; the
    // current API expects `implicitValue.coin = { deposit, withdrawals,
    // reclaimDeposit }`. Without it the selector under-funds the tx and the
    // node rejects with ValueNotConservedUTxO.
    const implicitCoin = Cardano.util?.computeImplicitCoin
        ? Cardano.util.computeImplicitCoin(buildContext.protocolParameters, {
              certificates,
              withdrawals: []
          })
        : { deposit: stakeKeyDeposit * BigInt(toRegister.length), withdrawals: 0n, reclaimDeposit: 0n };

    const buildForSelection = (selection) => {
        const bodyWithHash = createTransactionInternals({
            inputSelection: selection,
            validityInterval: buildContext.validityInterval,
            outputs: [],
            certificates,
            referenceInputs: refInputsSet,
            collaterals: new Set([collateralIn]),
            requiredExtraSignatures: requiredSigners,
            scriptIntegrityHash: '0'.repeat(64)
        });
        return Promise.resolve({
            id: transactionHashFromCore({ body: bodyWithHash.body }),
            body: bodyWithHash.body,
            witness: {
                signatures: buildPlaceholderSignatures(1),
                redeemers: certRedeemers
            }
        });
    };
    const constraints = defaultSelectionConstraints({
        protocolParameters: buildContext.protocolParameters,
        buildTx: buildForSelection,
        redeemersByType: { certificate: certRedeemers },
        txEvaluator,
        implicitValue: { coin: implicitCoin }
    });
    const selection = await inputSelector.select({
        preSelectedUtxo: new Set(),
        utxo: new Set(cleanUtxos.filter((u) => u !== collateralUtxo)),
        outputs: new Set([]),
        constraints,
        implicitValue: { coin: implicitCoin }
    });

    // Conway-aware computeScriptDataHash. The upstream cardano-sdk one
    // serialises redeemers as an Alonzo-era CBOR array even though the
    // Conway witness set encodes them as a CBOR map; the chain hashes the
    // bytes actually in the witness set (map form), so the upstream output
    // mismatches and every submitted tx gets rejected with
    // PPViewHashesDontMatch. Inlined from
    // decentralized-minting/lib/helpers/cardano-sdk/computeScriptDataHash.js.
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const { blake2b } = require_('@cardano-sdk/crypto');
    const computeScriptDataHash = (costModelsMap, usedLangs, redeemers_, datums) => {
        if ((!redeemers_ || redeemers_.length === 0) && (!datums || datums.length === 0)) return undefined;
        const requiredCostModels = new Serialization.Costmdls();
        for (const lang of usedLangs) {
            const costModel = costModelsMap.get(lang);
            if (costModel) requiredCostModels.insert(new Serialization.CostModel(lang, costModel));
        }
        const languageViewsHex = requiredCostModels.languageViewsEncoding();
        let redeemersCborHex;
        if (redeemers_ && redeemers_.length > 0) {
            const w = new Serialization.CborWriter();
            w.writeStartMap(redeemers_.length);
            for (const r of redeemers_) {
                w.writeStartArray(2);
                const tag = r.purpose === Cardano.RedeemerPurpose.spend ? 0
                    : r.purpose === Cardano.RedeemerPurpose.mint ? 1
                    : r.purpose === Cardano.RedeemerPurpose.certificate ? 2
                    : 3;
                w.writeInt(tag);
                w.writeInt(r.index);
                w.writeStartArray(2);
                w.writeEncodedValue(Uint8Array.from(Buffer.from(Serialization.PlutusData.fromCore(r.data).toCbor(), 'hex')));
                w.writeStartArray(2);
                w.writeInt(Number(r.executionUnits.memory));
                w.writeInt(Number(r.executionUnits.steps));
            }
            redeemersCborHex = Buffer.from(w.encode()).toString('hex');
        }
        const w = new Serialization.CborWriter();
        if (!redeemersCborHex) return undefined;
        w.writeEncodedValue(Uint8Array.from(Buffer.from(redeemersCborHex, 'hex')));
        // No datums for cert-only registration.
        w.writeEncodedValue(Uint8Array.from(Buffer.from(languageViewsHex, 'hex')));
        const encoded = Buffer.from(w.encode()).toString('hex');
        return blake2b.hash(encoded, 32);
    };
    const scriptDataHash = computeScriptDataHash(
        buildContext.protocolParameters.costModels,
        [Cardano.PlutusLanguageVersion.V3],
        certRedeemers,
        []
    );

    const finalBody = createTransactionInternals({
        inputSelection: selection.selection,
        validityInterval: buildContext.validityInterval,
        outputs: [],
        certificates,
        referenceInputs: refInputsSet,
        collaterals: new Set([collateralIn]),
        requiredExtraSignatures: requiredSigners,
        ...(scriptDataHash ? { scriptIntegrityHash: scriptDataHash } : {})
    });
    const unsignedTx = {
        id: finalBody.hash,
        body: { ...finalBody.body, fee: selection.selection.fee },
        witness: {
            signatures: new Map(),
            redeemers: certRedeemers
        }
    };

    // 6. Sign with e2e payment key
    const txHashHex = String(unsignedTx.id);
    const sig = await e2e.paymentKey.sign(txHashHex);
    const pub = await e2e.paymentKey.toPublic();
    const signedTx = {
        ...unsignedTx,
        witness: {
            ...unsignedTx.witness,
            signatures: new Map([[pub.hex(), sig.hex()]])
        }
    };
    const signedCborHex = transactionToCbor(signedTx);
    console.log(`Tx hash: ${txHashHex}`);
    console.log(`Fee:     ${selection.selection.fee} lovelace`);
    console.log(`Cbor len: ${signedCborHex.length / 2} bytes`);

    // 7. Submit
    console.log('Submitting...');
    const submitResult = await submitTx({ network, signedTxCborHex: signedCborHex, blockfrostApiKey });
    console.log(`SUBMITTED: ${submitResult}`);
};

main().catch((err) => {
    console.error('FAILED:', err.stack ?? err.message ?? err);
    process.exit(1);
});

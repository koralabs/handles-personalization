#!/usr/bin/env node
//
// Mainnet variant of registerObserverCredentials.js.
//
// Registers the perspz + persdsg observer script-credentials so the V3
// personalize spend tx can do its `withdraw 0` observer trick. Funds the
// tx from POLICY_KEY derivation 1 (mainnet minting wallet d1) — d12
// (kora-team admin) is also viable but d1 has a deeper balance.
//
// perslfc IS included by default: from the V3-split generation onward it is
// the withdraw observer for Migrate/Revoke/Update/ReturnToSender
// (aiken/validators/perslfc.ak), and it is registered on preprod (tx
// 9416925f…) and preview. An earlier revision skipped it ("no log-fund
// mode") back when mainnet's old pers flow never withdrew through it —
// that skip is exactly how mainnet ended up with perslfc unregistered, so
// the default now covers all three; use --observers to narrow explicitly.
//
// Usage:
//   node scripts/registerObserverCredentialsMainnet.js \
//        [--blockfrost-api-key <key>]   (or BLOCKFROST_API_KEY env)
//        [--policy-key <bech32 xprv>]   (or POLICY_KEY env, read from
//                                       minting.handle.me/.env by default)
//        [--funding-derivation <n>]     (default 1)
//        [--observers perspz,persdsg,perslfc]   (default all three)
//
// Pre-flight checks: skips already-registered credentials, refuses to
// proceed if local plutus.json hashes don't match what the failing
// personalize tx expects.

import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

import { roundRobinRandomImprove } from '@cardano-sdk/input-selection';
import {
    createTransactionInternals,
    defaultSelectionConstraints,
    GreedyTxEvaluator
} from '@cardano-sdk/tx-construction';
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
import { getPolicyWallet } from '../helpers/cardano-sdk/policyKeyWallet.js';

const NETWORK = 'mainnet';
const NETWORK_ID = 1;
const HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const LBL_222 = '000de140';
const PLUTUS_JSON = '/home/jesse/src/koralabs/handles-personalization/aiken/plutus.json';

const computeV3Hash = async (cborHex) => {
    await sodium.ready;
    const tagged = Buffer.concat([Buffer.from([0x03]), Buffer.from(cborHex, 'hex')]);
    return Buffer.from(sodium.crypto_generichash(28, tagged)).toString('hex');
};

const loadEnv = (path) => {
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

const main = async () => {
    const args = parseArgs(process.argv.slice(2));

    const minting = loadEnv('/home/jesse/src/koralabs/minting.handle.me/.env');
    const blockfrostApiKey = (args['blockfrost-api-key'] || process.env.BLOCKFROST_API_KEY || minting.BLOCKFROST_API_KEY || '').trim();
    if (!blockfrostApiKey) throw new Error('BLOCKFROST_API_KEY required (mainnet)');
    const policyKeyBech32 = (args['policy-key'] || process.env.POLICY_KEY || minting.POLICY_KEY || '').trim();
    if (!policyKeyBech32) throw new Error('POLICY_KEY required');
    const derivation = Number.parseInt(args['funding-derivation'] || '1', 10);
    const collateralDerivation = Number.parseInt(args['collateral-derivation'] || '2', 10);

    const observersWanted = (args.observers || 'perspz,persdsg,perslfc')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    // 1. Compute V3 observer hashes from local plutus.json
    const blueprint = JSON.parse(readFileSync(PLUTUS_JSON, 'utf8'));
    const find = (title) => {
        const v = blueprint.validators.find((v) => v.title === title);
        if (!v) throw new Error(`validator ${title} not found in plutus.json`);
        return v.compiledCode;
    };
    const allObservers = {
        perspz: { handle: 'perspz1@handlecontract', hash: await computeV3Hash(find('perspz.perspz.withdraw')) },
        perslfc: { handle: 'perslfc1@handlecontract', hash: await computeV3Hash(find('perslfc.perslfc.withdraw')) },
        persdsg: { handle: 'persdsg1@handlecontract', hash: await computeV3Hash(find('persdsg.persdsg.withdraw')) }
    };
    const observers = observersWanted.map((name) => {
        if (!allObservers[name]) throw new Error(`unknown observer: ${name}`);
        return { name, ...allObservers[name] };
    });
    console.log('V3 observer hashes (from local plutus.json):');
    for (const o of observers) console.log(`  ${o.name}: ${o.hash}`);

    // 2. Funding + collateral wallets (separate derivations so we have at
    //    least 2 distinct ada-only UTxOs — the d* addresses typically hold
    //    one UTxO each, so we can't reuse one wallet for both slots.)
    const d1 = getPolicyWallet({ policyKeyBech32, derivation, network: NETWORK });
    const dC = derivation === collateralDerivation
        ? d1
        : getPolicyWallet({ policyKeyBech32, derivation: collateralDerivation, network: NETWORK });
    console.log(`Funding wallet d${derivation}: ${d1.address}`);
    if (dC !== d1) console.log(`Collateral wallet d${collateralDerivation}: ${dC.address}`);

    const buildContext = await getBlockfrostBuildContext(NETWORK, blockfrostApiKey);
    const stakeKeyDeposit = BigInt(buildContext.protocolParameters.stakeKeyDeposit ?? 2_000_000);
    console.log(`Stake key deposit: ${stakeKeyDeposit} lovelace each`);

    // 3. Skip already-registered credentials
    const checkRegistered = async (scriptHash) => {
        const rewardAddr = Cardano.RewardAddress.fromCredentials(NETWORK_ID, {
            hash: scriptHash,
            type: Cardano.CredentialType.ScriptHash
        }).toAddress().toBech32();
        const r = await fetch(`https://cardano-${NETWORK}.blockfrost.io/api/v0/accounts/${rewardAddr}`,
            { headers: { project_id: blockfrostApiKey } });
        if (!r.ok) return false;
        const j = await r.json();
        // Blockfrost `registered` is the registration state; `active` stays
        // false for script reward accounts that never delegate, so testing
        // `active` would wrongly re-register (node rejects the duplicate
        // reg_cert). Proven on mainnet perspz/persdsg: registered:true, active:false.
        return j.registered === true;
    };
    const toRegister = [];
    for (const o of observers) {
        if (await checkRegistered(o.hash)) {
            console.log(`  ${o.name} (${o.hash}): already registered — skipping`);
        } else {
            toRegister.push(o);
        }
    }
    if (toRegister.length === 0) {
        console.log('Nothing to register — all credentials already active.');
        return;
    }
    console.log(`Registering ${toRegister.length} credentials...`);

    const certificates = toRegister.map((o) => ({
        __typename: 'RegistrationCertificate',
        stakeCredential: { hash: o.hash, type: Cardano.CredentialType.ScriptHash },
        deposit: stakeKeyDeposit
    }));

    // 4. Resolve each observer's deployed ref-script UTxO from chain
    const findRefScriptUtxo = async (observerName, expectedHash, handle) => {
        const handleHex = Buffer.from(handle, 'utf8').toString('hex');
        const assetUnit = `${HANDLE_POLICY}${LBL_222}${handleHex}`;
        const txsRes = await fetch(`https://cardano-${NETWORK}.blockfrost.io/api/v0/assets/${assetUnit}/transactions?order=desc&count=10`,
            { headers: { project_id: blockfrostApiKey } });
        if (!txsRes.ok) throw new Error(`/assets/${assetUnit}/transactions: HTTP ${txsRes.status}`);
        const txs = await txsRes.json();
        for (const tx of txs) {
            const u = await fetch(`https://cardano-${NETWORK}.blockfrost.io/api/v0/txs/${tx.tx_hash}/utxos`,
                { headers: { project_id: blockfrostApiKey } });
            if (!u.ok) continue;
            const ud = await u.json();
            for (const o of ud.outputs ?? []) {
                if (o.consumed_by_tx) continue;
                if (!(o.amount ?? []).some((a) => a.unit === assetUnit && BigInt(a.quantity) >= 1n)) continue;
                if (o.reference_script_hash !== expectedHash) continue;
                return `${tx.tx_hash}#${o.output_index}`;
            }
        }
        throw new Error(`no on-chain ref-script for ${observerName} (${expectedHash})`);
    };

    const referenceInputs = [];
    const certRedeemers = [];
    for (let i = 0; i < toRegister.length; i += 1) {
        const o = toRegister[i];
        const ref = await findRefScriptUtxo(o.name, o.hash, o.handle);
        console.log(`  ${o.name} ref-script utxo: ${ref}`);
        const [txId, idxStr] = ref.split('#');
        referenceInputs.push({ txId: Cardano.TransactionId(txId), index: Number.parseInt(idxStr, 10) });
        certRedeemers.push({
            purpose: Cardano.RedeemerPurpose.certificate,
            index: i,
            data: Serialization.PlutusData.fromCbor('d87980').toCore(),
            executionUnits: { memory: 1_000_000, steps: 200_000_000 }
        });
    }

    // 5. Pick ada-only input UTxO from d1 and collateral UTxO from dC
    const inputUtxos = (await fetchBlockfrostUtxos(d1.address, blockfrostApiKey, NETWORK))
        .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
        .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n)));
    if (inputUtxos.length === 0) throw new Error(`d${derivation} has no ada-only UTxOs`);

    const collateralUtxos = (dC === d1
        ? inputUtxos
        : (await fetchBlockfrostUtxos(dC.address, blockfrostApiKey, NETWORK))
            .filter((u) => (u[1].value.assets?.size ?? 0) === 0)
            .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n))));
    const collateralUtxo = collateralUtxos.find((u) => (u[1].value.coins ?? 0n) >= 10_000_000n);
    if (!collateralUtxo) throw new Error(`d${collateralDerivation} has no ada-only UTxO ≥ 10 ADA for collateral`);
    const collateralIn = { txId: collateralUtxo[0].txId, index: collateralUtxo[0].index };
    // Required signers: input owner (d1) + collateral owner (dC) if different
    const requiredSigners = dC === d1
        ? [d1.publicKeyHash]
        : [d1.publicKeyHash, dC.publicKeyHash];

    // 6. Build the tx
    const inputSelector = roundRobinRandomImprove({
        changeAddressResolver: {
            resolve: async (selection) =>
                selection.change.map((change) => ({ ...change, address: asPaymentAddress(d1.address) }))
        }
    });
    const txEvaluator = new GreedyTxEvaluator(async () => buildContext.protocolParameters);
    const refInputsSet = new Set(referenceInputs);

    const implicitCoin = Cardano.util?.computeImplicitCoin
        ? Cardano.util.computeImplicitCoin(buildContext.protocolParameters, { certificates, withdrawals: [] })
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
        // When collateral comes from a different wallet, all of d1's UTxOs
        // are available as inputs. When collateral is from d1, exclude the
        // collateral UTxO so it isn't double-spent.
        utxo: new Set(dC === d1 ? inputUtxos.filter((u) => u !== collateralUtxo) : inputUtxos),
        outputs: new Set([]),
        constraints,
        implicitValue: { coin: implicitCoin }
    });

    // 7. Conway-aware scriptDataHash
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const { blake2b } = require_('@cardano-sdk/crypto');
    const computeScriptDataHash = (costModelsMap, usedLangs, redeemers_) => {
        if (!redeemers_ || redeemers_.length === 0) return undefined;
        const requiredCostModels = new Serialization.Costmdls();
        for (const lang of usedLangs) {
            const cm = costModelsMap.get(lang);
            if (cm) requiredCostModels.insert(new Serialization.CostModel(lang, cm));
        }
        const languageViewsHex = requiredCostModels.languageViewsEncoding();
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
        const redeemersCborHex = Buffer.from(w.encode()).toString('hex');
        const w2 = new Serialization.CborWriter();
        w2.writeEncodedValue(Uint8Array.from(Buffer.from(redeemersCborHex, 'hex')));
        w2.writeEncodedValue(Uint8Array.from(Buffer.from(languageViewsHex, 'hex')));
        return blake2b.hash(Buffer.from(w2.encode()), 32);
    };
    const scriptDataHash = computeScriptDataHash(
        buildContext.protocolParameters.costModels,
        [Cardano.PlutusLanguageVersion.V3],
        certRedeemers
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

    // 8. Sign with d1 (and dC if different) — StrictaHQ key → raw Ed25519
    //    signature of the tx hash. Add a vkey witness per required signer.
    const txHashHex = String(unsignedTx.id);
    const txHashBuf = Buffer.from(txHashHex, 'hex');
    const sigs = new Map();
    sigs.set(Buffer.from(d1.publicKey).toString('hex'),
             Buffer.from(d1.privateKey.sign(txHashBuf)).toString('hex'));
    if (dC !== d1) {
        sigs.set(Buffer.from(dC.publicKey).toString('hex'),
                 Buffer.from(dC.privateKey.sign(txHashBuf)).toString('hex'));
    }
    const signedTx = { ...unsignedTx, witness: { ...unsignedTx.witness, signatures: sigs } };
    const signedCborHex = transactionToCbor(signedTx);
    console.log(`Tx hash: ${txHashHex}`);
    console.log(`Fee:     ${selection.selection.fee} lovelace`);
    console.log(`Total cost (fee + ${toRegister.length}×${stakeKeyDeposit} deposit): ${Number(selection.selection.fee) + Number(stakeKeyDeposit) * toRegister.length} lovelace`);
    console.log(`Cbor len: ${signedCborHex.length / 2} bytes`);

    console.log('Submitting...');
    const submitResult = await submitTx({ network: NETWORK, signedTxCborHex: signedCborHex, blockfrostApiKey });
    console.log(`SUBMITTED: ${submitResult}`);
};

main().catch((err) => {
    console.error('FAILED:', err.stack ?? err.message ?? err);
    process.exit(1);
});

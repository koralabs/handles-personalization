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

    // 4. Build certificates
    const certificates = toRegister.map((o) => ({
        __typename: 'RegistrationCertificate',
        stakeCredential: {
            hash: o.hash,
            type: Cardano.CredentialType.ScriptHash
        },
        deposit: stakeKeyDeposit
    }));

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
    const buildForSelection = (selection) => {
        const bodyWithHash = createTransactionInternals({
            inputSelection: selection,
            validityInterval: buildContext.validityInterval,
            outputs: [],
            certificates
        });
        return Promise.resolve({
            id: transactionHashFromCore({ body: bodyWithHash.body }),
            body: bodyWithHash.body,
            witness: { signatures: buildPlaceholderSignatures(1) }
        });
    };
    const constraints = defaultSelectionConstraints({
        protocolParameters: buildContext.protocolParameters,
        buildTx: buildForSelection,
        redeemersByType: {},
        txEvaluator,
        implicitValue: {
            // Total deposit drains from inputs, not from outputs.
            deposit: stakeKeyDeposit * BigInt(toRegister.length),
            input: 0n
        }
    });
    const selection = await inputSelector.select({
        preSelectedUtxo: new Set(),
        utxo: new Set(cleanUtxos),
        outputs: new Set([]),
        constraints
    });

    const finalBody = createTransactionInternals({
        inputSelection: selection.selection,
        validityInterval: buildContext.validityInterval,
        outputs: [],
        certificates
    });
    const unsignedTx = {
        id: finalBody.hash,
        body: { ...finalBody.body, fee: selection.selection.fee },
        witness: { signatures: new Map() }
    };

    // 6. Sign with e2e payment key
    const txHashHex = String(unsignedTx.id);
    const sig = await e2e.paymentKey.sign(txHashHex);
    const pub = await e2e.paymentKey.toPublic();
    const signedTx = {
        ...unsignedTx,
        witness: {
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

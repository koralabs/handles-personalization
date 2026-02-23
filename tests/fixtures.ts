
import * as helios from "@koralabs/helios";
import { Fixture, convertJsontoCbor, getAddressAtDerivation, getNewFakeUtxoId } from '@koralabs/kora-labs-contract-testing/fixtures.js'
import { AssetNameLabel } from '@koralabs/kora-labs-common'
import base58 from "bs58";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const POLICY_ID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const BG_POLICY_ID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9b';
const PFP_POLICY_ID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9c';
export const adminKeyBytes = '01234567890123456789012345678901234567890123456789000007';
export const adaHandleBytes = '01234567890123456789012345678901234567890123456789000003';
export const providerKeyHash = helios.PubKeyHash.fromHex('01234567890123456789012345678901234567890123456789000004');
export const lovelace = 10000000;
export const defaultNft = {
    name: '$<handle>',
    image: "ipfs://image",
    mediaType: "image/jpeg",
    og: 0,
    og_number: 1,
    rarity: "basic",
    length: 8,
    characters: "characters,numbers",
    numeric_modifiers: "",
    version: 1,
    attr: "rtta", 
};

export const defaultExtra = {
    image_hash: "0x",
    standard_image: "ipfs://image",
    standard_image_hash: "0x",
    bg_image: "ipfs://bg",
    pfp_image: "ipfs://pfp",
    designer: "ipfs://cid",
    bg_asset: `0x${BG_POLICY_ID}001bc2806267`,
    pfp_asset: `0x${PFP_POLICY_ID}000de140706670`,
    portal: "ipfs://cid",
    socials: "ipfs://cid",
    vendor: "ipfs://cid",
    default: 1,
    last_update_address: `0x${helios.bytesToHex((await getAddressAtDerivation(0)).bytes)}`,
    agreed_terms: "https://handle.me/$/tou",
    trial: 0,
    nsfw: 0,
    migrate_sig_required: 0,
    validated_by: '0x01234567890123456789012345678901234567890123456789000004',
};

export const defaultPzSettings = [
    1500000, //treasury_fee
    '0x01234567890123456789012345678901234567890123456789000002', //treasury_cred
    3500000, //pz_min_fee
    { //pz_providers
        '0x01234567890123456789012345678901234567890123456789000004': '0x01234567890123456789012345678901234567890123456789000004', 
        [`0x${adaHandleBytes}`]: `0x${adaHandleBytes}`
    }, 
    [] as string[], //valid_contracts
    [`0x${adminKeyBytes}`], //admin_creds
    `0x${adaHandleBytes}`, //settings_cred
    60 * 60, //grace_period
    50, //subhandle_share_percent
];


export const defaultAssigneeHash: string = '4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e2';
export const defaultResolvedAddress = helios.Address.fromHash(helios.PubKeyHash.fromHex(defaultAssigneeHash));

// The default fixture tests happy path with most features/lines of code executed
export class PzFixture extends Fixture {
    isVirtual = false;
    changedDesigner = true;
    handleName = 'xar123456';
    handleCbor: string;
    latestScriptAddress: helios.Address;

    oldCip68Datum = {
        constructor_0: [
            { ...defaultNft },
            0,
            { ...defaultExtra }
        ]
    };
    oldCip68DatumCbor: string;

    newCip68Datum = {
        constructor_0: [
            {
                ...defaultNft,
                image: "ipfs://pfp"
            },
            0,
            { ...defaultExtra }
        ]
    }
    newCip68DatumCbor: string;

    pzSettings = defaultPzSettings;
    pzSettingsCbor: string;

    bgDatum ={ // a.k.a. "Creator Defaults"
        constructor_0: [
            {
                ...defaultNft,
                image: "ipfs://bg"
            },
            0,
            {
                qr_inner_eye: "dots,#0a1fd4",
                qr_outer_eye: "dots,#0a1fd5",
                qr_dot: "dots,#0a1fd6",
                qr_image: "https://img",
                qr_bg_color: '0x0a1fd3',
                pfp_zoom: 130,
                pfp_offset: [60, 60],
                font: "the font",
                font_color: '0xffffff',
                font_shadow_size: [12, 10, 8],
                text_ribbon_colors: ['0x0a1fd3', '0x0a1fd4'],
                text_ribbon_gradient: "linear-45",
                bg_border_colors: ['0x0a1fd3', '0x22d1af', '0x31bc23'],
                bg_colors: ['0x0a1fd3', '0x22d1af', '0x31bc23'],
                circuit_colors: ['0x0a1fd3', '0x22d1af', '0x31bc23'],
                socials_color: '0xffffff',
                pfp_border_colors: ['0x0a1fd3', '0x22d1af', '0x31bc23'],
                font_shadow_colors: ['0x0a1fd3', '0x22d1af', '0x31bc23'],
                require_asset_collections: [ `0x${PFP_POLICY_ID}000de140706670`, `0x${PFP_POLICY_ID}706670` ],
                require_asset_attributes: ['attr:rtta'],
                require_asset_displayed: 1,
                price: 125,
                force_creator_settings: 1,
                custom_dollar_symbol: 0,
              }
        ]
    }
    bgDatumCbor: string;

    pfpDatum = {
        constructor_0: [
            {
                ...defaultNft,
                image: "ipfs://pfp"
            },
            0,
            { ...defaultExtra }
        ]
    }
    pfpDatumCbor: string;

    bgApprovers = { [`0x${BG_POLICY_ID}`]: {'0x001bc2806267': [0,0,0]} }
    bgApproversCbor: string;

    pfpApprovers = { [`0x${PFP_POLICY_ID}`]: {'0x000de140706670': [0,0,0],'0x706670706670': [0,0,0]} }
    pfpApproversCbor: string;

    rootSettings = [
        [ //nft
            1, //public_minting_enabled
            1, //pz_enabled
            [[0, 10000000]], //tier_pricing
            '0x', //creator_defaults,
        ],
        [ //virtual
            1, //public_minting_enabled
            1, //pz_enabled
            [[0, 10000000]], //tier_pricing
            '0x', //creator_defaults,
        ],
        0, //buy_down_price
        0, //buy_down_paid
        0, //buy_down_percent
        `0x68747470733A2F2F68616E646C652E6D652F242F746F75`, //agreed_terms
        0, //migrate_sig_required
        `0x`, //payment_address
    ];
    rootSettingsCbor: string

    oldDesigner = {
        pfp_border_color: '0x22d1af',
        qr_inner_eye: 'dots,#0a1fd4',
        qr_outer_eye: 'dots,#0a1fd5',
        qr_dot: 'dots,#0a1fd6',
        qr_bg_color: '0x0a1fd3',
        qr_image: 'https://img',
        pfp_zoom: 130,
        pfp_offset: [60, 60],
        font: 'the font',
        font_color: '0xffffff',
        font_shadow_size: [12, 10, 8],
        text_ribbon_colors: ['0x0a1fd3', '0x0a1fd4'],
        text_ribbon_gradient: 'linear-45',
        font_shadow_color: '0x22d1af',
        socials_color: '0xffffff',
        bg_border_color: '0x22d1af',
        bg_color: '0x22d1af',
        circuit_color: '0x22d1af',
        qr_link: '',
        socials: [],
        svg_version: 1,
    };
    newDesigner = {
        pfp_border_color: '0x22d1af',
        qr_inner_eye: 'dots,#0a1fd4',
        qr_outer_eye: 'dots,#0a1fd5',
        qr_dot: 'dots,#0a1fd6',
        qr_bg_color: '0x0a1fd3',
        qr_image: 'https://img',
        pfp_zoom: 130,
        pfp_offset: [60, 60],
        font: 'the font',
        font_color: '0xffffff',
        font_shadow_size: [12, 10, 8],
        text_ribbon_colors: ['0x0a1fd3', '0x0a1fd4'],
        text_ribbon_gradient: 'linear-45',
        font_shadow_color: '0x22d1af',
        socials_color: '0xffffff',
        bg_border_color: '0x22d1af',
        bg_color: '0x22d1af',
        circuit_color: '0x22d1af',
        qr_link: '',
        socials: [],
        svg_version: 1,
    };
    pzRedeemer = {
        constructor_0: [
            [{constructor_0: []}, this.handleName],
            '',
            [
                5, //pfp_approver
                4, //bg_approver
                2, //pfp_datum
                0, //bg_datum
                2, //required_asset
                6, //owner_settings
                0, //contract_output
                1, //pz_assets
                3, //provider_fee
            ],
            this.newDesigner,
            false
    ]
    };
    pzRedeemerCbor: string;

    requiredAsset = {
        constructor_0: [
            { ...defaultNft },
            0,
            { ...defaultExtra }
        ]
    };
    requiredAssetCbor: string;
    
    constructor(validatorHash: helios.ValidatorHash) {
        super(validatorHash);
        (this.oldCip68Datum.constructor_0[0] as any)['name'] = (this.oldCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
        (this.newCip68Datum.constructor_0[0] as any)['name'] = (this.newCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
        this.latestScriptAddress = this.scriptAddress;
        this.pzSettings[4] = [`0x${validatorHash.hex}`];
    }
    
    async initialize(): Promise<PzFixture> {
        const rootHandleName = this.handleName.split('@')[1];
        const handleByteLength = this.handleName.length.toString(16);
        this.handleCbor = `4${handleByteLength}${Buffer.from(this.handleName).toString('hex')}`;

        if (this.isVirtual) {
            (this.oldCip68Datum.constructor_0[2] as any) = {
                virtual: {
                    public_mint: 0,
                    expires_time: 0
                },
                resolved_addresses: {ada: `0x${defaultResolvedAddress.toHex()}`},
                ...(this.oldCip68Datum.constructor_0[2] as any)
            }; /// update datum for virtual subhandle
            (this.newCip68Datum.constructor_0[2] as any) = {
                virtual: {
                    public_mint: 0,
                    expires_time: 0
                },
                resolved_addresses: {ada: `0x${defaultResolvedAddress.toHex()}`},
                ...(this.newCip68Datum.constructor_0[2] as any),
                last_update_address: `0x${defaultResolvedAddress.toHex()}`,
            }; /// update datum for virtual subhandle
        }

        if (this.changedDesigner) {
            const oldDesignerCbor = (await convertJsontoCbor(this.oldDesigner)).replace('9fff', '80');
            const oldDesignerCid = this.calculateCid(oldDesignerCbor);
            const newDesignerCbor = (await convertJsontoCbor(this.newDesigner)).replace('9fff', '80');
            const newDesignerCid = this.calculateCid(newDesignerCbor);
            (this.oldCip68Datum.constructor_0[2] as any)['designer'] = `ipfs://${oldDesignerCid}`;
            (this.newCip68Datum.constructor_0[2] as any)['designer'] = `ipfs://${newDesignerCid}`;
        }

        this.oldCip68DatumCbor = await convertJsontoCbor(this.oldCip68Datum);
        this.newCip68DatumCbor = await convertJsontoCbor(this.newCip68Datum);

        this.pzSettingsCbor = await convertJsontoCbor(this.pzSettings);

        this.pzRedeemer.constructor_0[3] = this.newDesigner;
        this.pzRedeemerCbor = (await convertJsontoCbor(this.pzRedeemer));
        this.bgDatumCbor = await convertJsontoCbor(this.bgDatum);
        this.pfpDatumCbor = await convertJsontoCbor(this.pfpDatum);
        this.bgApproversCbor = await convertJsontoCbor(this.bgApprovers);
        this.pfpApproversCbor = await convertJsontoCbor(this.pfpApprovers);
        this.requiredAssetCbor = await convertJsontoCbor(this.requiredAsset);
        this.rootSettings[7] = `0x${(await getAddressAtDerivation(1)).toHex()}`
        this.rootSettingsCbor = await convertJsontoCbor(this.rootSettings);
        this.redeemer = helios.UplcData.fromCbor(this.pzRedeemerCbor);
        this.inputs = [            
            new helios.TxInput( // money & collateral
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(await getAddressAtDerivation(0), new helios.Value(BigInt(200000000))
            )),
            new helios.TxInput( // 100 Reference Token, BG 222, PFP 222, Handle
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    this.scriptAddress,
                    new helios.Value(BigInt(lovelace), new helios.Assets([[POLICY_ID, [
                        [`${this.isVirtual ? AssetNameLabel.LBL_000 : AssetNameLabel.LBL_100}${Buffer.from(this.handleName).toString('hex')}`, 1],
                        [`${AssetNameLabel.LBL_222}${Buffer.from("bg").toString('hex')}`, 1],  
                        [`${AssetNameLabel.LBL_222}${Buffer.from(this.handleName).toString('hex')}`, 1]
                    ]],[PFP_POLICY_ID, [
                        [`${AssetNameLabel.LBL_222}${Buffer.from("pfp").toString('hex')}`, 1]
                    ]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.oldCip68DatumCbor))
            ))
        ];
        this.refInputs = [
            new helios.TxInput( // bg_datum
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(1), new helios.Assets([[BG_POLICY_ID, [[`${AssetNameLabel.LBL_100}${Buffer.from("bg").toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.bgDatumCbor))
            )),
            new helios.TxInput( // required_asset
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(1), new helios.Assets([[PFP_POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from("pfp").toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.requiredAssetCbor))
            )),
            new helios.TxInput( // pfp_datum
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(1), new helios.Assets([[PFP_POLICY_ID, [[`${AssetNameLabel.LBL_100}${Buffer.from("pfp").toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.pfpDatumCbor))
            )),
            new helios.TxInput( // pz_settings
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    helios.Address.fromHash(helios.ValidatorHash.fromHex(adaHandleBytes)),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('pz_settings').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.pzSettingsCbor))
            )),
            new helios.TxInput( // bg_approver
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    helios.Address.fromHash(helios.ValidatorHash.fromHex(adaHandleBytes)),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('bg_policy_ids').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.bgApproversCbor))
            )),
            new helios.TxInput( // pfp_approver
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    helios.Address.fromHash(helios.ValidatorHash.fromHex(adaHandleBytes)),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('pfp_policy_ids').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.pfpApproversCbor))
            ))
        ];
        if (rootHandleName && this.rootSettingsCbor)
            this.refInputs.push(
                new helios.TxInput( // root settings
                    new helios.TxOutputId(getNewFakeUtxoId()),
                    new helios.TxOutput(
                        await getAddressAtDerivation(0),
                        new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_001}${Buffer.from(rootHandleName).toString('hex')}`, 1]]]])),
                        helios.Datum.inline(helios.UplcData.fromCbor(this.rootSettingsCbor))
                ))
            );
        this.outputs = [
            new helios.TxOutput( // 100 Reference Token
                this.latestScriptAddress,
                new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${this.isVirtual ? AssetNameLabel.LBL_000 : AssetNameLabel.LBL_100}${Buffer.from(this.handleName).toString('hex')}`, BigInt(1)]]]])),
                helios.Datum.inline(helios.UplcData.fromCbor(this.newCip68DatumCbor))
            ),
            new helios.TxOutput( // Pz Assets
                await getAddressAtDerivation(0),
                new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [
                    [`${AssetNameLabel.LBL_222}${Buffer.from("bg").toString('hex')}`, BigInt(1)],
                    [`${AssetNameLabel.LBL_222}${Buffer.from(this.handleName).toString('hex')}`, BigInt(1)]
                ]],[PFP_POLICY_ID, [
                    [`${AssetNameLabel.LBL_222}${Buffer.from("pfp").toString('hex')}`, BigInt(1)]
                ]]]))
            ),
            new helios.TxOutput( // Treasury Fee
                helios.Address.fromHash(helios.ValidatorHash.fromHex('01234567890123456789012345678901234567890123456789000002')),
                new helios.Value(BigInt(1500000)),
                helios.Datum.inline(helios.UplcData.fromCbor(this.handleCbor))
            ),
            new helios.TxOutput( // Provider Fee
                helios.Address.fromHash(helios.ValidatorHash.fromHex('01234567890123456789012345678901234567890123456789000004')),
                new helios.Value(BigInt(3500000)),
                helios.Datum.inline(helios.UplcData.fromCbor(this.handleCbor))
            )
        ];
        if (rootHandleName)
            this.outputs.push(
                new helios.TxOutput( // Root Handle Fee
                    await getAddressAtDerivation(1),
                    new helios.Value(BigInt(3500000 / 2)),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.handleCbor))
                )
            );
        this.signatories = [ providerKeyHash ]; // Provider or admin PubKeyHash
        return this;        
    }
  
    calculateCid(designer: any) {
        const hash = '01701220' + helios.bytesToHex(helios.Crypto.sha2_256(helios.hexToBytes(designer)));
        // console.log('CID = ' +  'z' + base58.encode([...Buffer.from(hash, 'hex')]), hash);
        return 'z' + base58.encode([...Buffer.from(hash, 'hex')]);   
    }
}

export class RevokeFixture extends Fixture {
    handleName = 'virt@xar';
    handleCbor: string;
    assigneePubKeyHash: string = defaultAssigneeHash;
    resolvedAddress = defaultResolvedAddress;
    oldCip68Datum = {
        constructor_0: [
            { ...defaultNft },
            0,
            {
                virtual: {
                    public_mint: 0,
                    expires_time: 0
                },
                resolved_addresses: {ada: defaultResolvedAddress},
                ...defaultExtra
            }
        ]
    };
    oldCip68DatumCbor: string;

    newCip68Datum = {
        constructor_0: [
            {
                ...defaultNft,
                image: "ipfs://pfp"
            },
            0,
            {
                virtual: {
                    public_mint: 0,
                    expires_time: Date.now()
                },
                resolved_addresses: {ada: defaultResolvedAddress},
                ...defaultExtra
            }
        ]
    }
    newCip68DatumCbor: string;
    
    pzSettings = defaultPzSettings;
    pzSettingsCbor: string
    
    revokeRedeemer = {
        constructor_2: [
            [{constructor_2: []}, this.handleName],
            'xar',
            0
        ]
    };
    revokeRedeemerCbor: string;
    
    handlePolicyHex = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
    handlePolicyPubKeyHash: string = '4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1';
    nativeScript: helios.NativeScript = helios.NativeScript.fromJson({
        type: 'sig',
        keyHash: this.handlePolicyPubKeyHash
    });

    constructor(validatorHash: helios.ValidatorHash) {
        super(validatorHash);
        (this.oldCip68Datum.constructor_0[0] as any)['name'] = (this.oldCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
        (this.newCip68Datum.constructor_0[0] as any)['name'] = (this.newCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
    }
    
    async initialize(): Promise<RevokeFixture> {
        const handleByteLength = this.handleName.length.toString(16);
        const rootHandleName = this.handleName.split('@')[1];
        this.revokeRedeemer.constructor_2[1] = rootHandleName;
        this.handleCbor = `4${handleByteLength}${Buffer.from(this.handleName).toString('hex')}`;
        this.oldCip68DatumCbor = await convertJsontoCbor(this.oldCip68Datum);
        this.newCip68DatumCbor = await convertJsontoCbor(this.newCip68Datum);
        this.revokeRedeemerCbor = (await convertJsontoCbor(this.revokeRedeemer));
        this.resolvedAddress = helios.Address.fromHash(helios.PubKeyHash.fromHex(this.assigneePubKeyHash));
        this.redeemer = helios.UplcData.fromCbor(this.revokeRedeemerCbor);
        this.pzSettingsCbor = await convertJsontoCbor(this.pzSettings);
        this.inputs = [     
            new helios.TxInput( // money & collateral
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(await getAddressAtDerivation(0), new helios.Value(BigInt(200000000))
            )),
            new helios.TxInput( // 222 Root Handle
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(lovelace),
                        new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from(rootHandleName).toString('hex')}`, BigInt(1)]]]]))
            )),
            new helios.TxInput( // 000 Virtual SubHandle
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    this.scriptAddress,
                    new helios.Value(BigInt(lovelace),
                        new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_000}${Buffer.from(this.handleName).toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.oldCip68DatumCbor))
            ))
        ];
        this.refInputs = [
            new helios.TxInput( // pz_settings
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    helios.Address.fromHash(helios.ValidatorHash.fromHex(adaHandleBytes)),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('pz_settings').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.pzSettingsCbor))
            ))
        ];
        this.outputs = [
            new helios.TxOutput( // 222 Root Handle
                await getAddressAtDerivation(0),
                new helios.Value(BigInt(lovelace),
                    new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from(rootHandleName).toString('hex')}`, BigInt(1)]]]]))
            )
        ]
        this.signatories = [helios.PubKeyHash.fromHex(this.handlePolicyPubKeyHash)];
        return this;
    }

}

export class UpdateFixture extends Fixture {
    handleName = 'sub@xar';
    handleCbor: string;
    assigneePubKeyHash: string = defaultAssigneeHash;
    resolvedAddress = defaultResolvedAddress;
    oldCip68Datum = {
        constructor_0: [
            { ...defaultNft },
            0,
            {
                virtual: {
                    public_mint: 0,
                    expires_time: Date.now()
                },
                resolved_addresses: {ada: `0x${defaultResolvedAddress.hex}`},
                ...defaultExtra
            }
        ]
    };
    oldCip68DatumCbor: string;

    newCip68Datum = {
        constructor_0: [
            { ...defaultNft },
            0,
            {
                virtual: {
                    public_mint: 0,
                    expires_time: Date.now() + (365 * 24 * 60 * 60 * 1000)
                },
                resolved_addresses: {ada: `0x${defaultResolvedAddress.hex}`},
                ...defaultExtra
            }
        ]
    }
    newCip68DatumCbor: string;
    
    pzSettings = defaultPzSettings;
    pzSettingsCbor: string
    
    adminSettings = [
        [], // valid_contracts
        [`0x${adminKeyBytes}`], // admin_creds
        5000000, // virtual_price
        10000000, // base_price
        [[0,0]], // buy_down_prices
        `0x`, // payment_address
        365 * 24 * 60 * 60 * 1000, // expiry_duration
        30 * 24 * 60 * 60 * 1000, // renewal_window
    ];
    adminSettingsCbor: string
    
    rootSettings = [
            [ //nft
                1, //public_minting_enabled
                1, //pz_enabled
                [[0, 10000000]], //tier_pricing
                '0x', //creator_defaults,
            ],
            [ //virtual
                1, //public_minting_enabled
                1, //pz_enabled
                [[0, 10000000]], //tier_pricing
                '0x', //creator_defaults,
            ],
            0, //buy_down_price
            0, //buy_down_paid
            0, //buy_down_percent
            `0x68747470733A2F2F68616E646C652E6D652F242F746F75`, //agreed_terms
            0, //migrate_sig_required
            `0x`, //payment_address
    ];
    rootSettingsCbor: string

    updateRedeemer = {
        constructor_3: [
            [{constructor_2: []}, this.handleName],
            "xar",
            [
                1, //admin_settings
                2, //root_settings
                1, //contract_output
                0  //root_handle
            ]
        ]
    };
    updateRedeemerCbor: string;
    
    handlePolicyHex = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
    handlePolicyPubKeyHash: string = '4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1';
    nativeScript: helios.NativeScript = helios.NativeScript.fromJson({
        type: 'sig',
        keyHash: this.handlePolicyPubKeyHash
    });

    constructor(validatorHash: helios.ValidatorHash) {
        super(validatorHash);
        (this.oldCip68Datum.constructor_0[0] as any)['name'] = (this.oldCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
        (this.newCip68Datum.constructor_0[0] as any)['name'] = (this.newCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', this.handleName);
    }
    
    async initialize(): Promise<UpdateFixture> {
        const handleByteLength = this.handleName.length.toString(16);
        const rootHandleName = this.handleName.split('@')[1];
        this.handleCbor = `4${handleByteLength}${Buffer.from(this.handleName).toString('hex')}`;
        this.oldCip68DatumCbor = await convertJsontoCbor(this.oldCip68Datum);
        this.newCip68DatumCbor = await convertJsontoCbor(this.newCip68Datum);
        this.updateRedeemer.constructor_3[1] = rootHandleName;
        this.updateRedeemerCbor = (await convertJsontoCbor(this.updateRedeemer));
        this.resolvedAddress = helios.Address.fromHash(helios.PubKeyHash.fromHex(this.assigneePubKeyHash));
        this.redeemer = helios.UplcData.fromCbor(this.updateRedeemerCbor);
        this.pzSettingsCbor = await convertJsontoCbor(this.pzSettings);
        this.adminSettings[5] = `0x${(await getAddressAtDerivation(0)).toHex()}`
        this.adminSettingsCbor = await convertJsontoCbor(this.adminSettings);
        this.rootSettings[7] = `0x${(await getAddressAtDerivation(1)).toHex()}`
        this.rootSettingsCbor = await convertJsontoCbor(this.rootSettings);
        this.inputs = [     
            new helios.TxInput( // money & collateral
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(await getAddressAtDerivation(0), new helios.Value(BigInt(200000000))
            )),
            new helios.TxInput( // 222 Root Handle
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(lovelace),
                        new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from(rootHandleName).toString('hex')}`, BigInt(1)]]]]))
            )),
            new helios.TxInput( // 000 Virtual SubHandle
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    this.scriptAddress,
                    new helios.Value(BigInt(lovelace),
                        new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_000}${Buffer.from(this.handleName).toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.oldCip68DatumCbor))
            ))
        ];
        this.refInputs = [
            new helios.TxInput( // pz_settings
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    helios.Address.fromHash(helios.ValidatorHash.fromHex(adaHandleBytes)),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('pz_settings').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.pzSettingsCbor))
            )),
            new helios.TxInput( // admin settings
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from('sh_settings').toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.adminSettingsCbor))
            )),
            new helios.TxInput( // root settings
                new helios.TxOutputId(getNewFakeUtxoId()),
                new helios.TxOutput(
                    await getAddressAtDerivation(0),
                    new helios.Value(BigInt(1), new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_001}${Buffer.from(rootHandleName).toString('hex')}`, 1]]]])),
                    helios.Datum.inline(helios.UplcData.fromCbor(this.rootSettingsCbor))
            ))
        ];
        this.outputs = [
            new helios.TxOutput( // 222 Root Handle
                await getAddressAtDerivation(0),
                new helios.Value(BigInt(lovelace),
                    new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_222}${Buffer.from(rootHandleName).toString('hex')}`, BigInt(1)]]]]))
            ),
            new helios.TxOutput(// 000 Virtual SubHandle
                this.scriptAddress,
                new helios.Value(BigInt(lovelace),
                    new helios.Assets([[POLICY_ID, [[`${AssetNameLabel.LBL_000}${Buffer.from(this.handleName).toString('hex')}`, 1]]]])),
                helios.Datum.inline(helios.UplcData.fromCbor(this.newCip68DatumCbor))
            ),
            new helios.TxOutput( // pay to main address
                helios.Address.fromHash(helios.PubKeyHash.fromHex(this.adminSettings[5].slice(4))),
                new helios.Value(BigInt(5000000)),
                helios.Datum.inline(helios.UplcData.fromCbor(this.handleCbor))
            ),
            new helios.TxOutput( // pay to root address
                helios.Address.fromHash(helios.PubKeyHash.fromHex(this.rootSettings[7].slice(4))),
                new helios.Value(BigInt(5000000)),
                helios.Datum.inline(helios.UplcData.fromCbor(this.handleCbor))
            ),
        ]
        this.signatories = [helios.PubKeyHash.fromHex(this.handlePolicyPubKeyHash)];
        return this;
    }

}

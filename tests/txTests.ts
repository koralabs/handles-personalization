import fs from "fs";
import * as helios from "@koralabs/helios";
import { ContractTester, Test } from '@koralabs/kora-labs-contract-testing/contractTester.js';
import { Fixture, getAddressAtDerivation } from '@koralabs/kora-labs-contract-testing/fixtures.js';
import { defaultAssigneeHash, defaultExtra, defaultNft, defaultResolvedAddress, PzFixture, RevokeFixture, UpdateFixture } from "./fixtures";
import { AssetNameLabel } from "@koralabs/kora-labs-common";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const runTests = async (file: string) => {
    const walletAddress = await getAddressAtDerivation(0);
    const tester = new ContractTester(walletAddress, false);
    await tester.init(process.env.TEST_GROUP, process.env.TEST_NAME);

    let contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile); //new instance
    const setupRevokeTx = (fixture: Fixture, validFrom?: Date) => {          
        const revokeTx = new helios.Tx();
        const fixt = fixture as RevokeFixture;
        revokeTx.attachScript(fixt.nativeScript);
        revokeTx.mintTokens(fixt.handlePolicyHex, [[`${AssetNameLabel.LBL_000}${Buffer.from(fixt.handleName).toString('hex')}`, -1]], null);
        if (validFrom != undefined) revokeTx.validFrom(validFrom);
        
        return revokeTx;
    }
    const setupUpdateTx = (validFrom?: Date) => {
        const tx = new helios.Tx();
        if (validFrom != undefined) tx.validFrom(validFrom);
        return tx;
    }
    // PERSONALIZE - SHOULD APPROVE
    await tester.test("PERSONALIZE", "main - test most things", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        return await fixture.initialize();
    }));

    await tester.test("PERSONALIZE", "unenforced defaults", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.bgDatum.constructor_0[2] as any) = {};
        (fixture.newDesigner as any) = {
            pfp_border_color: '0x22d1af',
            qr_inner_eye: 'square,#0a1fd4',
            qr_outer_eye: 'square,#0a1fd5',
            qr_dot: 'square,#0a1fd6',
            qr_bg_color: '0x0a1fd3',
            pfp_zoom: 130,
            pfp_offset: [60, 60],
            font_shadow_size: [12, 10, 8],
            text_ribbon_colors: ['0x0a1fd3'],
            font_shadow_color: '0x22d1af',
            socials_color: '0xffffff',
            bg_border_color: '0x22d1af',
            bg_color: '0x22d1af',
            circuit_color: '0x22d1af',
            qr_link: '',
            socials: [],
            svg_version: 1
        }
        return await fixture.initialize();
    }));

    await tester.test("PERSONALIZE", "subhandle pz if pz_root enabled, pz_subhandle disabled", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1; /// enable pz in new datum
        fixture.handleName = 'dev@golddy'; /// nft subhandle
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_1: [] },
          fixture.handleName,
        ]; /// update redeemer as `NFT_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }));

    await tester.test("PERSONALIZE", "subhandle pz in grace period", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1; /// enable pz in new datum
        (fixture.oldCip68Datum.constructor_0[2] as any)["last_edited_time"] = Date.now(); /// just edited
        fixture.handleName = 'dev@golddy'; /// nft subhandle
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_1: [] },
          fixture.handleName,
        ]; /// update redeemer as `NFT_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        const initialized = await fixture.initialize();
        /// remove provider fee
        initialized.outputs?.splice(2, 2);
        return initialized;
    }));

    await tester.test("PERSONALIZE", "subhandle pz if pz_subhandle enabled, pz_root disabled", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        fixture.handleName = 'dev@golddy'; /// nft subhandle
        (fixture.rootSettings[0] as any)[1] = 0; /// OwnerSetting NFT pz_enabled to false
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1; /// enable subhandle pz
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_1: [] },
          fixture.handleName,
        ]; /// update redeemer as `NFT_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }));

    await tester.test("PERSONALIZE", "virtual subhandle pz", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.isVirtual = true;
        fixture.handleName = 'dev@golddy'; /// virtual subhandle
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1; /// enable pz in old datum
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_2: [] },
          fixture.handleName,
        ]; /// update redeemer as `VIRTUAL_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        const initialized = await fixture.initialize();
        /// sign by resolved address
        if (defaultResolvedAddress.pubKeyHash) fixture.signatories?.push(defaultResolvedAddress.pubKeyHash);
        return initialized;
    }));

    await tester.test("PERSONALIZE", "pz without designer change", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        /// disable designer change
        fixture.changedDesigner = false;
        /// make new datum as reset
        fixture.newCip68Datum = {
            constructor_0: [
                {
                    ...defaultNft,
                },
                0,
                { ...defaultExtra, pfp_asset: undefined, bg_asset: undefined, pfp_image: undefined, bg_image: undefined, designer: undefined } as any
            ]
        };
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = (fixture.newCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', fixture.handleName);
        const initialized = await fixture.initialize();
        /// remove provider fee
        initialized.outputs?.splice(3, 1);
        return initialized;
    }));

    await tester.test("PERSONALIZE", "pz designer is set but unchanged", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        /// disable designer change
        fixture.changedDesigner = false;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = (fixture.newCip68Datum.constructor_0[0] as any)['name'].replace('<handle>', fixture.handleName);
        const initialized = await fixture.initialize();
        /// remove provider fee
        initialized.outputs?.splice(2, 2);
        return initialized;
    }));

    // PERSONALIZE - SHOULD DENY
    await tester.test("PERSONALIZE", "exclusives set, no creator", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.bgDatum.constructor_0[2] as any) = {};
        fixture.newDesigner.qr_inner_eye = 'dots,#0a1fd3';
        return await fixture.initialize();
    }), false, 'qr_inner_eye is not set correctly'),

    // Should Deny if resolved_address contain ada (for `HANDLE` type)
    await tester.test("PERSONALIZE", "resolved_addresses can't contain ada", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.newCip68Datum.constructor_0[2] as any) = {
            ...(fixture.newCip68Datum.constructor_0[2] as any),
            resolved_addresses: {ada: `0x${defaultResolvedAddress.toHex()}`},
        };
        return await fixture.initialize();
    }), false, "resolved_addresses can't contain 'ada'");

    // Should deny if root pz is disabled (for `NFT_SUBHANDLE` type)
    await tester.test("PERSONALIZE", "root pz is disabled", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        fixture.handleName = 'dev@golddy'; /// nft subhandle
        (fixture.rootSettings[0] as any)[1] = 0; /// OwnerSetting NFT pz_enabled to false
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_1: [] },
          fixture.handleName,
        ]; /// update redeemer as `NFT_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }), false, "Root SubHandle settings prohibit Personalization");

    await tester.test("PERSONALIZE", "should not pz if virtual assignee didn't sign", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.isVirtual = true;
        fixture.handleName = 'dev@golddy'; /// virtual subhandle
        fixture.newDesigner.bg_color = "0x31bc23"; /// do pz
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1; /// enable pz in old datum
        (fixture.pzRedeemer.constructor_0[0] as any) = [
          { constructor_2: [] },
          fixture.handleName,
        ]; /// update redeemer as `VIRTUAL_SUBHANDLE` type
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy'; /// root handle name
        /// in case `this.handleName` is updated after constructor
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }), false, "Tx not signed by virtual SubHandle holder");

    await tester.test("PERSONALIZE", "virtual subhandle resolved address can't change", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.isVirtual = true;
        fixture.handleName = 'dev@golddy';
        fixture.newDesigner.bg_color = "0x31bc23";
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_2: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[2] as any).resolved_addresses = {
            ada: `0x${helios.Address.fromHash(helios.PubKeyHash.fromHex("4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f978888")).hex}`,
        };
        const initialized = await fixture.initialize();
        if (defaultResolvedAddress.pubKeyHash) initialized.signatories?.push(defaultResolvedAddress.pubKeyHash);
        return initialized;
    }), false, "resolved_addresses.ada must not change");

    await tester.test("PERSONALIZE", "virtual subhandle datum can't change", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.isVirtual = true;
        fixture.handleName = 'dev@golddy';
        fixture.newDesigner.bg_color = "0x31bc23";
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_2: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[2] as any).virtual = {
            public_mint: 0,
            expires_time: Date.now() + 1_000_000
        };
        const initialized = await fixture.initialize();
        if (defaultResolvedAddress.pubKeyHash) initialized.signatories?.push(defaultResolvedAddress.pubKeyHash);
        return initialized;
    }), false, "Virtual SubHandle datum must not change");

    await tester.test("PERSONALIZE", "virtual subhandle requires pubkey address", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.isVirtual = true;
        fixture.handleName = 'dev@golddy';
        fixture.newDesigner.bg_color = "0x31bc23";
        (fixture.oldCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_2: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        const validatorAddress = helios.Address.fromHash(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any).resolved_addresses = { ada: `0x${validatorAddress.hex}` };
        (fixture.newCip68Datum.constructor_0[2] as any).resolved_addresses = { ada: `0x${validatorAddress.hex}` };
        return await fixture.initialize();
    }), false, "Only PubKeyHashes are supported");

    await tester.test("PERSONALIZE", "subhandle root mismatch", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23";
        fixture.handleName = 'dev@golddy';
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'wrongroot';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }), false, "Incorrect root handle for SubHandle");

    await tester.test("PERSONALIZE", "subhandle requires pz_enabled", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23";
        fixture.handleName = 'dev@golddy';
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 0;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        return await fixture.initialize();
    }), false, "SubHandle 'pz_enabled' should be 1");

    await tester.test("PERSONALIZE", "subhandle must pay root fee", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23";
        fixture.handleName = 'dev@golddy';
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        const initialized = await fixture.initialize();
        initialized.outputs?.splice(4, 1);
        return initialized;
    }), false, "Fee not paid to root Handle");

    await tester.test("PERSONALIZE", "required background signature missing", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.bgDatum.constructor_0[2] as any).required_signature = '0x01234567890123456789012345678901234567890123456789000007';
        return await fixture.initialize();
    }), false, "Required signature for background not present");

    await tester.test("PERSONALIZE", "bg asset and image must match", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        delete (fixture.newCip68Datum.constructor_0[2] as any).bg_image;
        return await fixture.initialize();
    }), false, "bg_asset/bg_image mismatch");

    await tester.test("PERSONALIZE", "bg image must match asset datum image", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.newCip68Datum.constructor_0[2] as any).bg_image = "ipfs://wrong-bg";
        return await fixture.initialize();
    }), false, "bg_image doesn't match bg_asset datum");

    await tester.test("PERSONALIZE", "pfp asset and image must match", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        delete (fixture.newCip68Datum.constructor_0[2] as any).pfp_image;
        return await fixture.initialize();
    }), false, "pfp_asset/pfp_image mismatch");

    await tester.test("PERSONALIZE", "pfp image must match asset datum image", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.newCip68Datum.constructor_0[2] as any).pfp_image = "ipfs://wrong-pfp";
        return await fixture.initialize();
    }), false, "pfp_image doesn't match pfp_asset datum");

    await tester.test("PERSONALIZE", "agreed terms must stay canonical", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        (fixture.newCip68Datum.constructor_0[2] as any).agreed_terms = "https://example.com/terms";
        return await fixture.initialize();
    }), false, "agreed_terms must be set");

    await tester.test("PERSONALIZE", "subhandle root settings token required", new Test(program, async (hash) => {
        const fixture = new PzFixture(hash);
        fixture.newDesigner.bg_color = "0x31bc23";
        fixture.handleName = 'dev@golddy';
        (fixture.newCip68Datum.constructor_0[2] as any)["pz_enabled"] = 1;
        (fixture.pzRedeemer.constructor_0[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        (fixture.pzRedeemer.constructor_0[1] as any) = 'golddy';
        (fixture.oldCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        (fixture.newCip68Datum.constructor_0[0] as any)['name'] = `$${fixture.handleName}`;
        const initialized = await fixture.initialize();
        initialized.refInputs?.[6]?.output.setValue(
            new helios.Value(BigInt(1), new helios.Assets([[
                'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a',
                [[`${AssetNameLabel.LBL_222}${Buffer.from('golddy').toString('hex')}`, BigInt(1)]]
            ]]))
        );
        return initialized;
    }), false, "Root settings not found");

    // Should reset to default styles
    // virtual must have resolved_addresses.ada

    // REVOKE - SHOULD APPROVE - private mint and signed by root
    await tester.test("REVOKE", "private mint and signed by root", new Test(program, async (hash) => {
        return await (new RevokeFixture(hash).initialize());
    }, setupRevokeTx)),

    // should Deny revoke if private but NOT signed by root
    await tester.test("REVOKE", "private but not signed by root", new Test(program, async (hash) => {
        const fixture = new RevokeFixture(hash);
        const initialized = await fixture.initialize();
        initialized.inputs?.splice(1, 1); /// remove 222 root_handle in inputs (remove root_signed)
        initialized.outputs?.splice(0, 1); /// remove 222 root_handle in outputs (remove root_signed)
        return initialized;
    }, setupRevokeTx), false, "Publicly minted Virtual SubHandle hasn't expired"),

    // should only revoke if public and expired
    await tester.test("REVOKE", "public and expired", new Test(program, async (hash) => {
        const fixture = new RevokeFixture(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any).virtual = { 
            public_mint: 1, /// public = true
            expires_time: Date.now()
        }
        const initialized = await fixture.initialize();
        initialized.inputs?.splice(1, 1); /// remove 222 root_handle in inputs (remove root_signed)
        initialized.outputs?.splice(0, 1); /// remove 222 root_handle in outputs (remove root_signed)
        return initialized;
    }, (fixture) => setupRevokeTx(fixture, new Date(Date.now() + 1_000_000)))),

    // show Deny if public but NOT expired
    await tester.test("REVOKE", "public mint not expired", new Test(program, async (hash) => {
        const fixture = new RevokeFixture(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any)['virtual'] = {
            public_mint: 1,
            expires_time: Date.now(),
        };
        return await fixture.initialize()
    }, setupRevokeTx), false, 'Publicly minted Virtual SubHandle hasn\'t expired'),

    await tester.test("REVOKE", "revoke only supports virtual handles", new Test(program, async (hash) => {
        const fixture = new RevokeFixture(hash);
        (fixture.revokeRedeemer.constructor_2[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        return await fixture.initialize();
    }, setupRevokeTx), false, "Only valid for Virtual SubHandles"),


    // UPDATE - change_address - SHOULD APPROVE - private & root_signed & address_changed
    await tester.test("UPDATE", "private mint address changed", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        /// update resolved_address
        (fixture.newCip68Datum.constructor_0[2] as any)["resolved_addresses"] 
            = {ada: `0x${helios.Address.fromHash(helios.PubKeyHash.fromHex("4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f978888")).hex}`};
        (fixture.newCip68Datum.constructor_0[2] as any)["virtual"]["expires_time"] = Date.now(); /// make not extended
        return await fixture.initialize();
    })),

    // should Update - extend - private & root_signed & good payment
    await tester.test("UPDATE", "private mint extended", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        return await fixture.initialize();
    }, () => setupUpdateTx(new Date(Date.now() + (365 * 24 * 60 * 60 * 1000))))), // within window

    // should Update - extend - public & NOT root_signed && assignee signed with payment cred
    await tester.test("UPDATE", "public assignee signed", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any)['virtual'] = {
            public_mint: 1,
            expires_time: Date.now(),
        }; /// make public
        (fixture.updateRedeemer.constructor_3[2] as any) = [
            1, //admin_settings
            2, //root_settings
            0, //contract_output - /// update index because we remove one output below
            0  //root_handle
        ];
        const initialized =  await fixture.initialize();
        initialized.inputs?.splice(1, 1); /// remove 222 root_handle in inputs (remove root_signed)
        initialized.outputs?.splice(0, 1); /// remove 222 root_handle in outputs (remove root_signed)
        initialized.signatories?.push(helios.PubKeyHash.fromHex(defaultAssigneeHash)); /// sign with assignee's pub key hash
        return initialized;
    }, () => setupUpdateTx(new Date(Date.now() + (365 * 24 * 60 * 60 * 1000))))); // within window

    // should Update - to_private - public & root_signed & expired & extended
    await tester.test("UPDATE", "public to private", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any)['virtual'] = {
            public_mint: 1,
            expires_time: Date.now(),
        }; /// make public
        (fixture.newCip68Datum.constructor_0[2] as any)['virtual'] = {
            public_mint: 0,
            expires_time: Date.now() + (365 * 24 * 60 * 60 * 1000),
        }; /// udpate to private and extend
        return await fixture.initialize();
    }, () => setupUpdateTx(new Date(Date.now() + (365 * 24 * 60 * 60 * 1000))))), /// make expired & within window

    // should Deny update if assignee NOT signed when public & NOT root_signed
    await tester.test("UPDATE", "public assignee not signed", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.oldCip68Datum.constructor_0[2] as any)['virtual'] = {
            public_mint: 1,
            expires_time: Date.now(),
        }; /// make public
        (fixture.updateRedeemer.constructor_3[2] as any) = [
            1, //admin_settings
            2, //root_settings
            0, //contract_output - /// update index because we remove one output below
            0  //root_handle
        ];
        const initialized =  await fixture.initialize();
        initialized.inputs?.splice(1, 1); /// remove 222 root_handle in inputs (remove root_signed)
        /// only take second one which is 000 Virtual Subhandle (remove 222 root_handle & payment to main & root)
        initialized.outputs = initialized.outputs?.[1] ? [initialized.outputs?.[1]] : [];
        return initialized;
    }), false, "No valid signature"),

    // should Deny if we update pz rather than virtual & resolved address
    await tester.test("UPDATE", "update pz rather than virtual & resolved address", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.newCip68Datum.constructor_0[2] as any).portal = "ipfs://new_cid"; /// update pz
        return await fixture.initialize();
    }), false, "Restricted changes are not allowed"),

    // should Deny if we update nft rather than virtual & resolved address
    await tester.test("UPDATE", "update nft rather than virtual & resolved address", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.newCip68Datum.constructor_0[0] as any) = {
            ...(fixture.newCip68Datum.constructor_0[0] as any),
            image: "ipfs://new_image"
        }; /// update nft
        return await fixture.initialize();
    }), false, "Restricted changes are not allowed"),
    await tester.test("UPDATE", "private mint extended with admin signer and no payment", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        const initialized = await fixture.initialize();
        initialized.outputs?.splice(2, 1); /// remove main payment
        return initialized;
    }, () => setupUpdateTx(new Date(Date.now() + (365 * 24 * 60 * 60 * 1000))))),
    await tester.test("UPDATE", "protocol settings token required", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.updateRedeemer.constructor_3[2] as any)[0] = 0; /// point admin_settings index to pz_settings input
        return await fixture.initialize();
    }), false, "Protocol SubHandle settings not found"),
    await tester.test("UPDATE", "root settings token required", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.updateRedeemer.constructor_3[2] as any)[1] = 0; /// point root_settings index to pz_settings input
        return await fixture.initialize();
    }), false, "Root SubHandle settings not found"),
    await tester.test("UPDATE", "update only supports virtual handles", new Test(program, async (hash) => {
        const fixture = new UpdateFixture(hash);
        (fixture.updateRedeemer.constructor_3[0] as any) = [{ constructor_1: [] }, fixture.handleName];
        return await fixture.initialize();
    }), false, "Only valid for Virtual SubHandles"),
    // can update to any address within wallet
    // virtual must have resolved_addresses.ada
    // main payment private/public or admin_signed
    // root payment public

    tester.displayStats();
}

(async()=> {
    await runTests('./contract.helios')
})(); 

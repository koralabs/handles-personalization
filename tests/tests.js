import fs from "fs";
import {Color} from '@koralabs/kora-labs-contract-testing/colors.js'
import * as tester from './contractTesting.js'
import { BackgroundDefaults, Datum, PzRedeemer, PzSettings, ScriptContext,
    ApprovedPolicyIds, handle, pz_provider_bytes, pfp_policy, MigrateRedeemer, script_tx_hash, 
    owner_bytes, bg_policy, TxInput, TxOutput, handles_tx_hash, ReturnRedeemer, handles_policy } from './testClasses.js'

let contract = fs.readFileSync("./contract.helios").toString();
//contract = contract.replace(/ctx.get_current_validator_hash\(\)/g, 'ValidatorHash::new(#01234567890123456789012345678901234567890123456789000001)');
tester.init();
const optimized = false;
const pzRedeemer = new PzRedeemer();
const resetRedeemer = new PzRedeemer(true);
const migrateRedeemer = new MigrateRedeemer();
const returnRedeemer = new ReturnRedeemer();

console.log(`${Color.FgMagenta}----------------------------TESTS START-----------------------------${Color.Reset}`);
    // PERSONALIZE ENDPOINT - SHOULD APPROVE
    await tester.testCase(true, "PERSONALIZE", "main", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "mem & cpu", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(true), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, null, true)
    await tester.testCase(true, "PERSONALIZE", "CIP-25 PFP as BG", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#0a1fd3}).data',
        delete redeemer.designer.text_ribbon_gradient;
        delete redeemer.designer.font_color;
        delete redeemer.designer.socials_color;
        delete redeemer.designer.font;
        delete redeemer.designer.qr_image;
        delete redeemer.designer.text_ribbon_colors;
        delete redeemer.designer.qr_inner_eye;
        delete redeemer.designer.qr_outer_eye;
        delete redeemer.designer.qr_dot;
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const pfpApproverList = new ApprovedPolicyIds(pfp_policy);
        pfpApproverList.map[`${pfp_policy}`] = {'#706670': [0,0,0], '#000de140706670': [0,0,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pfp_policy_ids"'])).output.datum = pfpApproverList.render();
        const bgOutput = context.outputs.find(output => output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_444', '"bg"']));
        bgOutput.replace([`MintingPolicyHash::new(${bg_policy})`, 'LBL_444', '"bg"'], [`MintingPolicyHash::new(${pfp_policy})`, '', '"pfp"']);
        const datum = new Datum(redeemer.calculateCid());
        datum.extra.bg_asset = `OutputDatum::new_inline(${pfp_policy}706670).data`;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "pfp CIP-25, defaults forced", () => {
        const pzRedeemer = new PzRedeemer();
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_222', '"pfp"'])).replace([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_222', '"pfp"'], [`MintingPolicyHash::new(${pfp_policy})`, '', '"pfp"']);
        context.referenceInputs.splice(context.referenceInputs.findIndex(input => input.output.has([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_100', '"pfp"'])), 1);
        pzRedeemer.indexes = `PzIndexes {pfp_approver: 2, bg_approver: 1, pfp_datum: 1, bg_datum: 0, required_asset: 4, owner_settings: 5, contract_output: 3, pz_assets: 0, provider_fee: 2}`;
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.pfp_asset = `OutputDatum::new_inline(${pfp_policy}706670).data`;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const pfpApproverList = new ApprovedPolicyIds(pfp_policy);
        pfpApproverList.map[`${pfp_policy}`] = {'#706670': [0,0,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pfp_policy_ids"'])).output.datum = pfpApproverList.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "require_asset_displayed Handle", () => {
        const pzRedeemer = new PzRedeemer();
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        delete datum.extra.pfp_image;
        delete datum.extra.pfp_asset;
        pzRedeemer.indexes = 'PzIndexes { pfp_approver: 3, bg_approver: 2, pfp_datum: 1, bg_datum: 0, required_asset: 5, owner_settings: 6, contract_output: 3, pz_assets: 0, provider_fee: 2 }';
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.require_asset_collections = `OutputDatum::new_inline([]ByteArray{${handles_policy}+LBL_222+"${handle}".encode_utf8()}).data`;
        bgDefaults.extra.require_asset_displayed = `OutputDatum::new_inline(1).data`;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        context.referenceInputs.push(new TxInput(`${script_tx_hash}`, context.outputs[3]));
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "require_asset_collections policy match", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.require_asset_collections = `OutputDatum::new_inline([]ByteArray{${pfp_policy}}).data`;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no defaults", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font = 'OutputDatum::new_inline(#).data';
        redeemer.designer.font_color = 'OutputDatum::new_inline(#).data';
        redeemer.designer.socials_color = 'OutputDatum::new_inline(#).data';
        redeemer.designer.qr_inner_eye = 'OutputDatum::new_inline("square,,#0a1fd4").data';
        redeemer.designer.qr_outer_eye = 'OutputDatum::new_inline("square,,#0a1fd4").data';
        redeemer.designer.qr_dot = 'OutputDatum::new_inline("square,,#0a1fd4").data';
        redeemer.designer.qr_image = 'OutputDatum::new_inline(#).data';
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#0a1fd3}).data';
        redeemer.designer.text_ribbon_gradient = 'OutputDatum::new_inline(#).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bg_ref = context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"']));
        const defaults = new BackgroundDefaults();
        defaults.extra = {};
        bg_ref.output.datum = defaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no forced defaults good", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font = 'OutputDatum::new_inline(#).data';
        redeemer.designer.font_color = 'OutputDatum::new_inline(#).data';
        // redeemer.designer.qr_inner_eye = 'OutputDatum::new_inline("square,#0a1fd4").data';
        // redeemer.designer.qr_outer_eye = 'OutputDatum::new_inline("square,#0a1fd4").data';
        redeemer.designer.qr_dot = 'OutputDatum::new_inline("square,#0a1fd4").data';
        redeemer.designer.qr_image = 'OutputDatum::new_inline(#).data';
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#0a1fd3}).data';
        redeemer.designer.text_ribbon_gradient = 'OutputDatum::new_inline(#).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bg_ref = context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"']));
        const defaults = new BackgroundDefaults();
        defaults.extra.force_creator_settings = 'OutputDatum::new_inline(0).data';
        bg_ref.output.datum = defaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "pfp_zoom in unenforced defaults but not defined", () => {
        const redeemer = new PzRedeemer();
        delete redeemer.designer.pfp_zoom;
        delete redeemer.designer.pfp_offset;
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.force_creator_settings;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "unenforced defaults, exclusive left blank", () => {
        const redeemer = new PzRedeemer();
        delete redeemer.designer.qr_image;
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.force_creator_settings;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "provider policies", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bg_policy_input = context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"bg_policy_ids"']));
        bg_policy_input.output.replace(['HANDLE_POLICY', 'LBL_222', '"bg_policy_ids"'], ['HANDLE_POLICY', 'LBL_222', '"partner@bg_policy_ids"']);
        bg_policy_input.output.hash = `${pz_provider_bytes}`;
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "good qr dot default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_dot = 'OutputDatum::new_inline("square,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_dot;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "good qr inner default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_inner_eye = 'OutputDatum::new_inline("square,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_inner_eye;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "good qr outer default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_outer_eye = 'OutputDatum::new_inline("square,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_outer_eye;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default shadow color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_shadow_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.font_shadow_colors;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default pfp border", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_border_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.pfp_border_colors;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default bg border", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.bg_border_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.bg_border_colors;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default qr bg color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_bg_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_bg_color;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default offset", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_offset = 'OutputDatum::new_inline([]Int{1,1}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.pfp_offset;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default shadow size", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_shadow_size = 'OutputDatum::new_inline([]Int{1,1,1}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.font_shadow_size;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "PERSONALIZE", "no default zoom", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_zoom = 'OutputDatum::new_inline(145).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.pfp_zoom;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })

    // PERSONALIZE ENDPOINT - SHOULD DENY
    await tester.testCase(false, "PERSONALIZE", "require_asset_displayed Handle not present", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        delete datum.extra.pfp_image;
        delete datum.extra.pfp_asset;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.require_asset_collections = `OutputDatum::new_inline([]ByteArray{${handles_policy}+LBL_222+"wrong_handle".encode_utf8()}).data`;
        bgDefaults.extra.require_asset_displayed = `OutputDatum::new_inline(1).data`;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required asset not correct")
    await tester.testCase(false, "PERSONALIZE", "wrong handle name", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_222', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_222', `"${handle}"`], ['HANDLE_POLICY', 'LBL_222', '"xar12346"']); 
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle input not present")
    await tester.testCase(false, "PERSONALIZE", "pfp_offset out of bounds", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_zoom = 'OutputDatum::new_inline(110).data';
        redeemer.designer.pfp_offset = 'OutputDatum::new_inline([]Int{60,60}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.pfp_zoom;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_offset is out of bounds")
    await tester.testCase(false, "PERSONALIZE", "font_shadow_size out of bounds", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_shadow_size = 'OutputDatum::new_inline([]Int{21,21,-1}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.font_shadow_size;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font_shadow_size is out of bounds")
    await tester.testCase(false, "PERSONALIZE", "pfp_zoom out of bounds", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_zoom = 'OutputDatum::new_inline(201).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.pfp_zoom;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_zoom is out of bounds")
    await tester.testCase(false, "PERSONALIZE", "wrong handle label", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_222', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_222', `"${handle}"`], ['HANDLE_POLICY', '#000653b0', `"${handle}"`]);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle input not present")
    await tester.testCase(false, "PERSONALIZE", "wrong handle policy", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_222', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_222', `"${handle}"`], ['MintingPolicyHash::new(#f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9b)', 'LBL_222', `"${handle}"`]);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle input not present")
    await tester.testCase(false, "PERSONALIZE", "bad ref token name", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_222', `"${handle}"`], ['HANDLE_POLICY', 'LBL_222', '"xar12346"']); 
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Contract output not present")
    await tester.testCase(false, "PERSONALIZE", "bad ref token label", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_100', `"${handle}"`], ['HANDLE_POLICY', 'LBL_444', `"${handle}"`]);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Contract output not present")
    await tester.testCase(false, "PERSONALIZE", "bad ref token policy", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).replace(['HANDLE_POLICY', 'LBL_100', `"${handle}"`], ['MintingPolicyHash::new(#123456789012345678901234567890123456789012345678901234af)', 'LBL_100', `"${handle}"`]);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Contract output not present")
    await tester.testCase(false, "PERSONALIZE", "bad ref token output", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).hash = '#123456789012345678901234567890123456789012345678901234af'
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Contract output not found in valid contracts list")
    await tester.testCase(false, "PERSONALIZE", "handle missing", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.splice(context.outputs.findIndex(output => output.has(['HANDLE_POLICY', 'LBL_222', `"${handle}"`])), 1);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "index out of range")
    await tester.testCase(false, "PERSONALIZE", "bg_policy_ids missing", () => {
        const pzRedeemer = new PzRedeemer();
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        pzRedeemer.indexes = 'PzIndexes { pfp_approver: 2, bg_approver: 2, pfp_datum: 1, bg_datum: 0, required_asset: 1, owner_settings: 5, contract_output: 3, pz_assets: 0, provider_fee: 2 }';
        context.referenceInputs.splice(context.referenceInputs.findIndex(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"bg_policy_ids"'])), 1);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_policy_ids reference input not present or not from valid provider")
    await tester.testCase(false, "PERSONALIZE", "bg_policy_ids wrong hash", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', `"bg_policy_ids"`])).output.hash = '#123456789012345678901234567890123456789012345678901234af'
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_policy_ids reference input not present or not from valid provider")
    await tester.testCase(false, "PERSONALIZE", "pfp_policy_ids missing", () => {
        const pzRedeemer = new PzRedeemer();
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.referenceInputs.splice(context.referenceInputs.findIndex(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pfp_policy_ids"'])), 1);
        pzRedeemer.indexes = 'PzIndexes { pfp_approver: 3, bg_approver: 2, pfp_datum: 1, bg_datum: 0, required_asset: 1, owner_settings: 5, contract_output: 3, pz_assets: 0, provider_fee: 2 }';
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_policy_ids reference input not present or not from valid provider")
    await tester.testCase(false, "PERSONALIZE", "pfp_policy_ids wrong hash", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', `"pfp_policy_ids"`])).output.hash = '#123456789012345678901234567890123456789012345678901234af'
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_policy_ids reference input not present or not from valid provider")
    await tester.testCase(false, "PERSONALIZE", "pz_settings invalid", () => {
        const pzRedeemer = new PzRedeemer();
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        pzRedeemer.indexes = 'PzIndexes { pfp_approver: 3, bg_approver: 2, pfp_datum: 1, bg_datum: 0, required_asset: 1, owner_settings: 5, contract_output: 3, pz_assets: 0, provider_fee: 2 }';
        context.referenceInputs.splice(context.referenceInputs.indexOf(context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pz_settings"']))), 1);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "not found")
    await tester.testCase(false, "PERSONALIZE", "pz_settings wrong hash", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', `"pz_settings"`])).output.hash = '#123456789012345678901234567890123456789012345678901234af'
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pz_settings reference input not from ADA Handle")
    await tester.testCase(false, "PERSONALIZE", "bad script creds", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new PzSettings();
        datum.valid_contracts = '[]ByteArray{#123456789012345678901234567890123456789012345678901234af}';
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', `"pz_settings"`])).output.datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Current contract not found in valid contracts list")
    await tester.testCase(false, "PERSONALIZE", "treas fee low", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 1500000).lovelace = 10;
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle treasury fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "treas fee no handle", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 1500000).datum = `"wrong".encode_utf8()`;
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle treasury fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "treas fee bad address", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 1500000).hash = '#123456789012345678901234567890123456789012345678901234af';
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle treasury fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "prov fee low", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 3500000).lovelace = 10;
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Personalization provider not found or fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "prov fee no handle", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 3500000).datum = `"wrong".encode_utf8()`;
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Personalization provider not found or fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "prov fee bad address", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.outputs.find(output => output.lovelace == 3500000).hash = '#123456789012345678901234567890123456789012345678901234af';
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Personalization provider not found or fee unpaid")
    await tester.testCase(false, "PERSONALIZE", "wrong bg_color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.bg_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong circuit_color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.circuit_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "circuit_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong socials_color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.socials_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "socials_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong bg_border", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.bg_border_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_border_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong pfp_border", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_border_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_border_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong ribbon gradient", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.text_ribbon_gradient = 'OutputDatum::new_inline("radial").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "text_ribbon_gradient is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong gradient colors", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#aaaaaa, #bbbbbb}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "text_ribbon_colors is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong gradient", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#aaaaaa}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.text_ribbon_gradient;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "text_ribbon_gradient is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong ribbon colors", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.text_ribbon_colors = 'OutputDatum::new_inline([]ByteArray{#aaaaaa}).data';
        redeemer.designer.text_ribbon_gradient = 'OutputDatum::new_inline("").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.text_ribbon_gradient;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "text_ribbon_colors is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong font color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_color = 'OutputDatum::new_inline(#aaaaaa).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong default font color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_color = 'OutputDatum::new_inline(#aaaaaa).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.font_color;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong default font", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font = 'OutputDatum::new_inline("this_really_cool_font").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.font;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong font color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font = 'OutputDatum::new_inline("this_really_cool_font").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong font shadow color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_shadow_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font_shadow_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong shadow size", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.font_shadow_size = 'OutputDatum::new_inline([]Int{1,1,1}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "font_shadow_size is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong pfp zoom", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_zoom = 'OutputDatum::new_inline(145).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_zoom is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong pfp offset", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.pfp_offset = 'OutputDatum::new_inline([]Int{1,1}).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_offset is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr bg color", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_bg_color = 'OutputDatum::new_inline(#dddddd).data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_bg_color is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr dots", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_dot = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_dot is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr inner", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_inner_eye = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_inner_eye is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr outer", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_outer_eye = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_outer_eye is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr dot default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_dot = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_dot;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_dot is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr inner default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_inner_eye = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_inner_eye;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_inner_eye is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr outer default", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_outer_eye = 'OutputDatum::new_inline("rounded,#dddddd").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_outer_eye;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_outer_eye is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong qr image", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_image = 'OutputDatum::new_inline("https://bad").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_image is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "no default qr image", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.qr_image;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_image is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "wrong pfp attr", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.require_asset_attributes = 'OutputDatum::new_inline([]String{"attr:wrong"}).data';
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required asset not correct")
    await tester.testCase(false, "PERSONALIZE", "wrong pfp", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.require_asset_collections = 'OutputDatum::new_inline([]ByteArray{#badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad}).data';
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "policy not found")
    await tester.testCase(false, "PERSONALIZE", "pfp not displayed", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        delete datum.extra.pfp_asset;
        delete datum.extra.pfp_image;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const goodPfpInput = new TxInput(`${handles_tx_hash}`, new TxOutput(`${owner_bytes}`, [[`MintingPolicyHash::new(${pfp_policy})`,'LBL_222','"pfppfp"']]));
        goodPfpInput.output.hashType = 'pubkey';
        context.referenceInputs.push(goodPfpInput);
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required asset not correct")
    await tester.testCase(false, "PERSONALIZE", "bad update address", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.last_update_address = `OutputDatum::new_inline(#6012345678901234567890123456789012345678901234567890123457).data`;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "last_update_address does not match Handle address")
    await tester.testCase(false, "PERSONALIZE", "unsigned validator", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        context.signers = [owner_bytes];
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "validated_by is set but not signed")
    await tester.testCase(false, "PERSONALIZE", "bg nsfw", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const approver =  new ApprovedPolicyIds(bg_policy);
        approver.map[bg_policy] = {"#001bc2806267": [1,0,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"bg_policy_ids"'])).output.datum = approver.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Trial/NSFW flags set incorrectly")
    await tester.testCase(false, "PERSONALIZE", "bg trial", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const approver =  new ApprovedPolicyIds(bg_policy);
        approver.map[bg_policy] = {"#001bc2806267": [0,1,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"bg_policy_ids"'])).output.datum = approver.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Trial/NSFW flags set incorrectly")
    await tester.testCase(false, "PERSONALIZE", "pfp nsfw", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const approver =  new ApprovedPolicyIds(pfp_policy);
        approver.map[`${pfp_policy}`] = {'#000de140706670': [1,0,0],'#706670706670': [1,0,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pfp_policy_ids"'])).output.datum = approver.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Trial/NSFW flags set incorrectly")
    await tester.testCase(false, "PERSONALIZE", "pfp trial", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const approver =  new ApprovedPolicyIds(pfp_policy);
        approver.map[`${pfp_policy}`] = {'#000de140706670': [0,1,0],'#706670706670': [0,1,0]}
        context.referenceInputs.find(input => input.output.has(['HANDLE_POLICY', 'LBL_222', '"pfp_policy_ids"'])).output.datum = approver.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Trial/NSFW flags set incorrectly")
    await tester.testCase(false, "PERSONALIZE", "can't use exclusive", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bg_ref = context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"']));
        const defaults = new BackgroundDefaults();
        defaults.extra = {};
        bg_ref.output.datum = defaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_inner_eye is not set correctly")
    await tester.testCase(false, "PERSONALIZE", "unenforced defaults, exclusive used", () => {
        const redeemer = new PzRedeemer();
        redeemer.designer.qr_image = 'OutputDatum::new_inline("https://wrong").data';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        delete bgDefaults.extra.force_creator_settings;
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "qr_image is not set correctly"),
    await tester.testCase(false, "PERSONALIZE", "handle redeemer mismatch", () => {
        const redeemer = new PzRedeemer();
        redeemer.handle = 'b"wrong_handle"';
        const context = new ScriptContext().initPz(redeemer.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Handle redeemer mismatch")
    await tester.testCase(false, "PERSONALIZE", "designer cid hash mismatch", () => {
        const redeemer = new PzRedeemer();
        const wrongDesigner = new PzRedeemer();
        wrongDesigner.designer.bg_color = 'OutputDatum::new_inline(#0a1fd3).data';
        const context = new ScriptContext().initPz(wrongDesigner.calculateCid());
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Personalization designer settings hash doesn't match CID multihash")
    await tester.testCase(false, "PERSONALIZE", "required background signature missing", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const bgDefaults = new BackgroundDefaults();
        bgDefaults.extra.required_signature = 'OutputDatum::new_inline(#01234567890123456789012345678901234567890123456789000007).data';
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${bg_policy})`, 'LBL_100', '"bg"'])).output.datum = bgDefaults.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required signature for background not present")
    await tester.testCase(false, "PERSONALIZE", "asset datum missing", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const pfpRef = context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_100', '"pfp"']));
        pfpRef.output.datumType = 'none';
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Asset datum not found")
    await tester.testCase(false, "PERSONALIZE", "immutables changed", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.standard_image = 'OutputDatum::new_inline("ipfs://changed").data';
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Immutables have changed")
    await tester.testCase(false, "PERSONALIZE", "agreed terms changed", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.agreed_terms = 'OutputDatum::new_inline("https://example.com/terms").data';
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "agreed_terms must be set")
    await tester.testCase(false, "PERSONALIZE", "bg_asset and bg_image mismatch", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        delete datum.extra.bg_image;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_asset/bg_image mismatch")
    await tester.testCase(false, "PERSONALIZE", "bg_image mismatches datum", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.bg_image = 'OutputDatum::new_inline("ipfs://wrong_bg").data';
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "bg_image doesn't match bg_asset datum")
    await tester.testCase(false, "PERSONALIZE", "pfp_asset and pfp_image mismatch", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        delete datum.extra.pfp_image;
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_asset/pfp_image mismatch")
    await tester.testCase(false, "PERSONALIZE", "pfp_image mismatches datum", () => {
        const context = new ScriptContext().initPz(pzRedeemer.calculateCid());
        const datum = new Datum(pzRedeemer.calculateCid());
        datum.extra.pfp_image = 'OutputDatum::new_inline("ipfs://wrong_pfp").data';
        context.outputs.find(output => output.has(['HANDLE_POLICY', 'LBL_100', `"${handle}"`])).datum = datum.render();
        const program = tester.createProgram(contract, new Datum().render(), pzRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "pfp_image doesn't match pfp_asset datum")

    // MIGRATE ENDPOINT - SHOULD APPROVE
    await tester.testCase(true, "MIGRATE", "admin, no owner", () => {
        const context = new ScriptContext().initMigrate();
        const program = tester.createProgram(contract, new Datum().render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(true, "MIGRATE", "hardcoded admin", () => {
        const context = new ScriptContext().initMigrate();
        context.signers = ['#4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1']
        const program = tester.createProgram(contract, new Datum().render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })

    // MIGRATE ENDPOINT - SHOULD DENY
    await tester.testCase(false, "MIGRATE", "wrong admin signer", () => {
        const context = new ScriptContext().initMigrate();
        context.signers = [`${owner_bytes}`];
        const program = tester.createProgram(contract, new Datum().render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required admin signer(s) not present")
    await tester.testCase(false, "MIGRATE", "no admin signers", () => {
        const context = new ScriptContext().initMigrate();
        context.signers = [];
        const program = tester.createProgram(contract, new Datum().render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required admin signer(s) not present")
    await tester.testCase(false, "MIGRATE", "owner signature required but owner token missing", () => {
        const context = new ScriptContext().initMigrate();
        const oldDatum = new Datum();
        oldDatum.extra.migrate_sig_required = 'OutputDatum::new_inline(1).data';
        context.outputs[0].datum = oldDatum.render();
        const program = tester.createProgram(contract, oldDatum.render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Required owner signer not present")
    await tester.testCase(false, "MIGRATE", "output changed during migration", () => {
        const context = new ScriptContext().initMigrate();
        const changed = new Datum();
        changed.extra.portal = 'OutputDatum::new_inline("ipfs://changed").data';
        context.outputs[0].datum = changed.render();
        const program = tester.createProgram(contract, new Datum().render(), migrateRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Not a valid migration"),

    // RESET ENDPOINT - SHOULD APPROVE
    await tester.testCase(true, "RESET", "no admin signer, pfp mismatch", () => {
        const context = new ScriptContext().initReset();
        context.referenceInputs.find(input => input.output.has([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_222', '"pfp"'])).output.replace([`MintingPolicyHash::new(${pfp_policy})`, 'LBL_222', '"pfp"'], [`MintingPolicyHash::new(#123456789012345678901234567890123456789012345678901234af)`, 'LBL_222', '"pfp"']);
        const program = tester.createProgram(contract, new Datum().render(), resetRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })

    // RESET ENDPOINT - SHOULD DENY
    await tester.testCase(false, "RESET", "reset not allowed because all good", () => {
        const context = new ScriptContext().initReset();
        const program = tester.createProgram(contract, new Datum().render(), resetRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, 'Reset is not allowed or not authorized')
    await tester.testCase(false, "RESET", "provider reset must clear personalization fields", () => {
        const context = new ScriptContext().initReset();
        context.signers = [`${pz_provider_bytes}`];
        context.outputs[0].datum = new Datum().render();
        const redeemer = new PzRedeemer(true);
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, 'Personalization properties not properly reset')
    await tester.testCase(false, "RESET", "socials must reset when holder changes", () => {
        const context = new ScriptContext().initReset();
        context.referenceInputs[5].output.hash = `${pz_provider_bytes}`;
        const datum = new Datum();
        datum.nft.image = datum.extra.standard_image;
        datum.extra.image_hash = datum.extra.standard_image_hash;
        delete datum.extra.designer;
        delete datum.extra.bg_asset;
        delete datum.extra.pfp_asset;
        delete datum.extra.pfp_image;
        delete datum.extra.bg_image;
        delete datum.extra.svg_version;
        delete datum.extra.validated_by;
        datum.extra.last_update_address = `OutputDatum::new_inline(#60 + ${pz_provider_bytes}).data`;
        datum.extra.socials = 'OutputDatum::new_inline("ipfs://cid").data';
        context.outputs[0].datum = datum.render();
        const redeemer = new PzRedeemer(true);
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, 'Socials need to be reset')
    await tester.testCase(false, "RESET", "resolved addresses must reset when holder changes", () => {
        const context = new ScriptContext().initReset();
        context.referenceInputs[5].output.hash = `${pz_provider_bytes}`;
        const datum = new Datum();
        datum.nft.image = datum.extra.standard_image;
        datum.extra.image_hash = datum.extra.standard_image_hash;
        delete datum.extra.designer;
        delete datum.extra.bg_asset;
        delete datum.extra.pfp_asset;
        delete datum.extra.pfp_image;
        delete datum.extra.bg_image;
        delete datum.extra.svg_version;
        delete datum.extra.validated_by;
        datum.extra.last_update_address = `OutputDatum::new_inline(#60 + ${pz_provider_bytes}).data`;
        datum.extra.socials = 'OutputDatum::new_inline("").data';
        datum.extra.resolved_addresses = 'OutputDatum::new_inline(Map[String]Data {"btc": OutputDatum::new_inline(#01).data}).data';
        context.outputs[0].datum = datum.render();
        const redeemer = new PzRedeemer(true);
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, 'resolved_addresses need to be reset')
    await tester.testCase(false, "RESET", "socials cannot be reset without authorization", () => {
        const context = new ScriptContext().initReset();
        const datum = new Datum();
        datum.nft.image = datum.extra.standard_image;
        datum.extra.image_hash = datum.extra.standard_image_hash;
        delete datum.extra.designer;
        delete datum.extra.bg_asset;
        delete datum.extra.pfp_asset;
        delete datum.extra.pfp_image;
        delete datum.extra.bg_image;
        delete datum.extra.svg_version;
        delete datum.extra.validated_by;
        datum.extra.socials = 'OutputDatum::new_inline("").data';
        context.outputs[0].datum = datum.render();
        const redeemer = new PzRedeemer(true);
        const program = tester.createProgram(contract, new Datum().render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "Socials shouldn't be reset")
    await tester.testCase(false, "RESET", "resolved addresses cannot be reset without authorization", () => {
        const context = new ScriptContext().initReset();
        const oldDatum = new Datum();
        oldDatum.extra.resolved_addresses = 'OutputDatum::new_inline(Map[String]Data {"btc": OutputDatum::new_inline(#01).data}).data';
        const datum = new Datum();
        datum.nft.image = datum.extra.standard_image;
        datum.extra.image_hash = datum.extra.standard_image_hash;
        delete datum.extra.designer;
        delete datum.extra.bg_asset;
        delete datum.extra.pfp_asset;
        delete datum.extra.pfp_image;
        delete datum.extra.bg_image;
        delete datum.extra.svg_version;
        delete datum.extra.validated_by;
        context.outputs[0].datum = datum.render();
        const redeemer = new PzRedeemer(true);
        const program = tester.createProgram(contract, oldDatum.render(), redeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    }, "resolved_addresses shouldn't be reset"),

    // RETURN_TO_SENDER ENDPOINT - SHOULD DENY
    await tester.testCase(false, "RETURN_TO_SENDER", "wrong admin signer", () => {
        const context = new ScriptContext().initReturnToSender();
        context.signers = [`${owner_bytes}`];
        const program = tester.createProgram(contract, new Datum().render(), returnRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    await tester.testCase(false, "RETURN_TO_SENDER", "can't return a handle reference token", () => {
        const context = new ScriptContext().initReturnToSender();
        context.inputs[0].output.replace(['MintingPolicyHash::new(#f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9b)', 'LBL_222', `"${handle}"`], ['HANDLE_POLICY', 'LBL_100', `"${handle}"`]);
        context.outputs[0].replace(['MintingPolicyHash::new(#f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9b)', 'LBL_222', `"${handle}"`], ['HANDLE_POLICY', 'LBL_100', `"${handle}"`]);
        const program = tester.createProgram(contract, new Datum().render(), returnRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })

    // RETURN_TO_SENDER ENDPOINT - SHOULD APPROVE
    await tester.testCase(true, "RETURN_TO_SENDER", "all good", () => {
        const context = new ScriptContext().initReturnToSender();
        const program = tester.createProgram(contract, new Datum().render(), returnRedeemer.render(), context.render());
        return { contract: program.compile(optimized), params: ["datum", "redeemer", "context"].map((p) => program.evalParam(p)) };
    })
    
    // Need tests for virt Pz (enabled? resolved.ada check?, sub@root check)
    // Need tests for NftSub Pz
    // can't change expiry
    tester.displayStats()

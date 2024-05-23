import fs from "fs";
import * as helios from "@koralabs/helios";
import { ContractTester, Test,  getAddressAtDerivation } from '@koralabs/kora-labs-contract-testing';
import { PzFixtures } from "./fixtures";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const runTests = async (file: string) => {
    let contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile); //new instance
    const contract = program.compile();

    let fixtures = await (new PzFixtures(contract.validatorHash).initialize());
    const walletAddress = await getAddressAtDerivation(0);
    const tester = new ContractTester(walletAddress);
    await tester.init();
    
    Promise.all([
        // SHOULD APPROVE
        tester.test("PERSONALIZE", "main - test most things", new Test(program, () => fixtures)),

        // SHOULD DENY
        // tester.test("GROUP", "example test 2", new Test(program, () => fixtures, () => {
        //     // custom tx setup
        //     return new helios.Tx();
        // }), false, "expected error message"),
    ]
    ).then(() => {tester.displayStats()});
}

(async()=> {
    await runTests('.//contract.helios')
})(); 
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildPersonalizationDeploymentTxArtifact,
  buildPersonalizationSettingsUpdateArtifact,
  buildPersonalizationSettingsUpdateTxArtifact,
  buildExpectedPersonalizationScriptHash,
  buildPersonalizationDeploymentPlan,
  discoverNextContractSubhandle,
  fetchLivePersonalizationDeploymentState,
  renderTransactionOrderMarkdown,
} from "../deploymentPlan.js";
import { loadDesiredDeploymentState } from "../deploymentState.js";

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    args[token.slice(2)] = next;
    index += 1;
  }
  return args;
};

const renderSummaryMarkdown = (summaryMarkdown, transactionOrder) => {
  const lines = summaryMarkdown.split("\n");
  const transactionOrderIndex = lines.lastIndexOf("## Transaction Order");
  if (transactionOrderIndex < 0) {
    return summaryMarkdown;
  }
  return [
    ...lines.slice(0, transactionOrderIndex + 1),
    ...renderTransactionOrderMarkdown(transactionOrder),
    ...lines.slice(transactionOrderIndex + 2),
  ].join("\n");
};

const loadNativeScriptCborHex = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const hex = parsed.native_script_cbor_hex || parsed.cbor_hex || parsed.cborHex;
    if (!hex) {
      throw new Error(`${filePath} missing native_script_cbor_hex`);
    }
    return String(hex).trim();
  }
  return trimmed;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const desiredPath = args.desired;
  const artifactsDir = args["artifacts-dir"];
  const changeAddress = args["change-address"] ?? "";
  const cborUtxosJson = args["cbor-utxos-json"] ?? "";
  const blockfrostApiKey = args["blockfrost-api-key"] ?? process.env.BLOCKFROST_API_KEY ?? "";
  const nativeScriptCborFile = args["native-script-cbor-file"] ?? "";
  if (!desiredPath || !artifactsDir) {
    throw new Error("usage: --desired <path> --artifacts-dir <dir> [--change-address <addr> --cbor-utxos-json <json>] [--blockfrost-api-key <key>] [--native-script-cbor-file <path>]");
  }
  if (Boolean(changeAddress) !== Boolean(cborUtxosJson)) {
    throw new Error("--change-address and --cbor-utxos-json must be provided together");
  }

  const desired = await loadDesiredDeploymentState(desiredPath);
  const userAgent = (process.env.KORA_USER_AGENT || "kora-contract-deployments/1.0").trim();
  const expectedScriptHash = buildExpectedPersonalizationScriptHash();
  const live = await fetchLivePersonalizationDeploymentState({
    network: desired.network,
    oldScriptType: desired.oldScriptType,
    userAgent,
  });
  const plan = buildPersonalizationDeploymentPlan({
    desired,
    expectedScriptHash,
    live,
    nextSubhandle: live.currentScriptHash === expectedScriptHash
      ? null
      : await discoverNextContractSubhandle({
          network: desired.network,
          deploymentHandleSlug: desired.deploymentHandleSlug,
          namespace: desired.subhandleStrategy.namespace,
          currentSubhandle: live.currentSubhandle,
          userAgent,
        }),
  });

  await fs.mkdir(artifactsDir, { recursive: true });
  const generatedArtifacts = ["summary.json", "summary.md", "deployment-plan.json"];
  let transactionOrder = [];
  let txArtifactGenerated = false;
  const writePlanFiles = async () => {
    await fs.writeFile(
      path.join(artifactsDir, "summary.json"),
      `${JSON.stringify(
        {
          ...plan.summaryJson,
          transaction_order: transactionOrder,
          tx_artifact_generated: txArtifactGenerated,
          artifact_files: generatedArtifacts,
        },
        null,
        2
      )}\n`
    );
    await fs.writeFile(
      path.join(artifactsDir, "summary.md"),
      `${renderSummaryMarkdown(plan.summaryMarkdown, transactionOrder)}\n`
    );
    await fs.writeFile(
      path.join(artifactsDir, "deployment-plan.json"),
      `${JSON.stringify(
        {
          ...plan.deploymentPlanJson,
          transaction_order: transactionOrder,
          tx_artifact_generated: txArtifactGenerated,
          artifact_files: generatedArtifacts,
        },
        null,
        2
      )}\n`
    );
  };
  await writePlanFiles();

  // Script-deploy tx-01.cbor: wallet-funded, single-signer (deployer wallet
  // holds the deployment SubHandle). Built when --change-address +
  // --cbor-utxos-json are supplied AND there's script-hash drift with an
  // allocate-able SubHandle.
  if (
    changeAddress &&
    cborUtxosJson &&
    (plan.driftType === "script_hash_only" || plan.driftType === "script_hash_and_settings") &&
    plan.summaryJson.contracts[0].subhandle.action === "allocate"
  ) {
    const handleName = String(plan.summaryJson.contracts[0].subhandle.value ?? "").trim();
    if (!handleName) {
      throw new Error("missing deployment handle for personalization tx artifact generation");
    }
    const txArtifact = await buildPersonalizationDeploymentTxArtifact({
      desired,
      handleName,
      changeAddress,
      cborUtxos: JSON.parse(cborUtxosJson),
    });
    const fileName = "tx-01.cbor";
    await fs.writeFile(path.join(artifactsDir, fileName), txArtifact.cborBytes);
    await fs.writeFile(path.join(artifactsDir, `${fileName}.hex`), `${txArtifact.cborHex}\n`);
    generatedArtifacts.push(fileName, `${fileName}.hex`);
    transactionOrder.push(fileName);
    txArtifactGenerated = true;
    await writePlanFiles();
  }

  // Settings update artifact: always emit the patched datum file when
  // settings drift exists. When --blockfrost-api-key + --native-script-cbor-file
  // are supplied AND there are actual field changes, also emit a full
  // tx-NN.cbor (numbered after any preceding deploy tx) signed by the native
  // script multisig.
  if (plan.driftType === "settings_only" || plan.driftType === "script_hash_and_settings") {
    const haveTxInputs = Boolean(blockfrostApiKey && nativeScriptCborFile);
    let txArtifact = null;
    let settingsArtifact;

    if (haveTxInputs) {
      const nativeScriptCborHex = await loadNativeScriptCborHex(nativeScriptCborFile);
      const built = await buildPersonalizationSettingsUpdateTxArtifact({
        live,
        desired,
        nativeScriptCborHex,
        blockfrostApiKey,
        userAgent,
      });
      settingsArtifact = built.settingsArtifact;
      txArtifact = built.txArtifact;
    } else {
      settingsArtifact = buildPersonalizationSettingsUpdateArtifact({ live, desired });
    }

    const datumFile = "patched-pz-settings.inline-datum.cbor";
    const summaryFile = "settings-update-summary.md";
    await fs.writeFile(path.join(artifactsDir, datumFile), settingsArtifact.newDatumCborBytes);

    let txFile = null;
    if (txArtifact) {
      const ordinal = String(transactionOrder.length + 1).padStart(2, "0");
      txFile = `tx-${ordinal}.cbor`;
      await fs.writeFile(path.join(artifactsDir, txFile), txArtifact.cborBytes);
      await fs.writeFile(path.join(artifactsDir, `${txFile}.hex`), `${txArtifact.cborHex}\n`);
      generatedArtifacts.push(txFile, `${txFile}.hex`);
      transactionOrder.push(txFile);
      txArtifactGenerated = true;
    }

    await fs.writeFile(
      path.join(artifactsDir, summaryFile),
      [
        `# Settings Update — ${settingsArtifact.handleName}`,
        "",
        `- Handle UTxO: \`${settingsArtifact.handleUtxoRef ?? "(unknown)"}\``,
        `- Old datum: \`${settingsArtifact.oldDatumHex.slice(0, 32)}...\` (${settingsArtifact.oldDatumHex.length / 2} bytes)`,
        `- New datum: \`${settingsArtifact.newDatumHex.slice(0, 32)}...\` (${settingsArtifact.newDatumHex.length / 2} bytes)`,
        ...(txArtifact
          ? [
              `- Tx file: \`${txFile}\``,
              `- Tx ID: \`${txArtifact.txId}\``,
              `- Estimated signed tx size: ${txArtifact.estimatedSignedTxSize} / ${txArtifact.maxTxSize} bytes`,
            ]
          : []),
        "",
        "## Field changes",
        ...(settingsArtifact.changeLog.length > 0
          ? settingsArtifact.changeLog.map((line) => `- ${line}`)
          : ["- No changes (live datum already matches desired YAML)."]),
        "",
        "## Next steps",
        ...(txArtifact
          ? [
              `1. Verify the diff above against the desired state in \`${path.basename(desiredPath)}\`.`,
              `2. Distribute \`${txFile}\` to multisig signers; each adds a vkey witness over the body hash.`,
              `3. Assemble all witnesses (\`cardano-cli transaction assemble\`) and submit.`,
              `4. Run this workflow again to verify — the diff should report no changes.`,
            ]
          : [
              `1. Verify the diff above against the desired state in \`${path.basename(desiredPath)}\`.`,
              `2. Re-run with \`--blockfrost-api-key\` and \`--native-script-cbor-file\` to emit \`tx-NN.cbor\`, or feed \`${datumFile}\` into the legacy multisig signing tool.`,
              `3. Submit; verify the resulting datum matches by running this workflow again — the diff should report no changes.`,
            ]),
      ].join("\n") + "\n"
    );
    generatedArtifacts.push(datumFile, summaryFile);
    await writePlanFiles();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

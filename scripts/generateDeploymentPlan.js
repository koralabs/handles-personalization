import fs from "node:fs/promises";
import path from "node:path";

import {
  buildPersonalizationDeploymentTxArtifact,
  buildPersonalizationSettingsUpdateArtifact,
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const desiredPath = args.desired;
  const artifactsDir = args["artifacts-dir"];
  const changeAddress = args["change-address"] ?? "";
  const cborUtxosJson = args["cbor-utxos-json"] ?? "";
  if (!desiredPath || !artifactsDir) {
    throw new Error("usage: --desired <path> --artifacts-dir <dir> [--change-address <addr> --cbor-utxos-json <json>]");
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

  // Settings-only artifact: emits a canonical patched datum for the multisig
  // signer to feed into the existing settings-update tooling. Independent of
  // --change-address / --cbor-utxos-json (those are for the script-deployment
  // tx; the settings update is signed by the native script multisig that
  // already controls the settings UTxO, no deployer wallet involved).
  if (plan.driftType === "settings_only" || plan.driftType === "script_hash_and_settings") {
    const settingsArtifact = buildPersonalizationSettingsUpdateArtifact({ live, desired });
    const datumFile = "patched-pz-settings.inline-datum.cbor";
    const summaryFile = "settings-update-summary.md";
    await fs.writeFile(path.join(artifactsDir, datumFile), settingsArtifact.newDatumCborBytes);
    await fs.writeFile(
      path.join(artifactsDir, summaryFile),
      [
        `# Settings Update — ${settingsArtifact.handleName}`,
        "",
        `- Handle UTxO: \`${settingsArtifact.handleUtxoRef ?? "(unknown)"}\``,
        `- Old datum: \`${settingsArtifact.oldDatumHex.slice(0, 32)}...\` (${settingsArtifact.oldDatumHex.length / 2} bytes)`,
        `- New datum: \`${settingsArtifact.newDatumHex.slice(0, 32)}...\` (${settingsArtifact.newDatumHex.length / 2} bytes)`,
        "",
        "## Field changes",
        ...(settingsArtifact.changeLog.length > 0
          ? settingsArtifact.changeLog.map((line) => `- ${line}`)
          : ["- No changes (live datum already matches desired YAML)."]),
        "",
        "## Next steps",
        `1. Verify the diff above against the desired state in \`${path.basename(desiredPath)}\`.`,
        `2. Feed \`${datumFile}\` into the multisig signing tool (cardano-cli build-raw + native-script witness).`,
        `3. Submit; verify the resulting datum matches by running this workflow again — the diff should report no changes.`,
      ].join("\n") + "\n"
    );
    generatedArtifacts.push(datumFile, summaryFile);
    await writePlanFiles();
  }

  if (
    changeAddress &&
    cborUtxosJson &&
    plan.driftType === "script_hash_only" &&
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
    transactionOrder = [fileName];
    txArtifactGenerated = true;
    await writePlanFiles();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

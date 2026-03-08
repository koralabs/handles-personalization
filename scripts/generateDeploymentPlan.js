import fs from "node:fs/promises";
import path from "node:path";

import {
  buildExpectedPersonalizationScriptHash,
  buildPersonalizationDeploymentPlan,
  fetchLivePersonalizationDeploymentState,
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const desiredPath = args.desired;
  const artifactsDir = args["artifacts-dir"];
  if (!desiredPath || !artifactsDir) {
    throw new Error("usage: --desired <path> --artifacts-dir <dir>");
  }

  const desired = await loadDesiredDeploymentState(desiredPath);
  const userAgent = (process.env.KORA_USER_AGENT || "kora-contract-deployments/1.0").trim();
  const expectedScriptHash = buildExpectedPersonalizationScriptHash();
  const live = await fetchLivePersonalizationDeploymentState({
    network: desired.network,
    userAgent,
  });
  const plan = buildPersonalizationDeploymentPlan({
    desired,
    expectedScriptHash,
    live,
    nextSubhandle: null,
  });

  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactsDir, "summary.json"),
    `${JSON.stringify(
      {
        ...plan.summaryJson,
        tx_artifact_generated: false,
        artifact_files: ["summary.json", "summary.md", "deployment-plan.json"],
      },
      null,
      2
    )}\n`
  );
  await fs.writeFile(path.join(artifactsDir, "summary.md"), `${plan.summaryMarkdown}\n`);
  await fs.writeFile(
    path.join(artifactsDir, "deployment-plan.json"),
    `${JSON.stringify(
      {
        ...plan.deploymentPlanJson,
        tx_artifact_generated: false,
        artifact_files: ["summary.json", "summary.md", "deployment-plan.json"],
      },
      null,
      2
    )}\n`
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

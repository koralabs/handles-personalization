import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HELIOS_CMD = "node --es-module-specifier-resolution=node tests/tests.js";

const AIKEN_MODULES = [
  "personalization/update",
  "personalization/personalize_mpf_context",
  "personalization/personalize_policy_approval",
];

const PARITY_MATRIX = [
  {
    id: "migrate_admin_no_owner",
    source: "tests.js",
    helios: { group: "MIGRATE", name: "admin, no owner" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
    },
  },
  {
    id: "migrate_hardcoded_admin",
    source: "tests.js",
    helios: { group: "MIGRATE", name: "hardcoded admin" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
    },
  },
  {
    id: "migrate_wrong_admin_signer",
    source: "tests.js",
    helios: { group: "MIGRATE", name: "wrong admin signer" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
    },
  },
  {
    id: "migrate_no_admin_signers",
    source: "tests.js",
    helios: { group: "MIGRATE", name: "no admin signers" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
    },
  },
  {
    id: "migrate_owner_token_required",
    source: "tests.js",
    helios: {
      group: "MIGRATE",
      name: "owner signature required but owner token missing",
    },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
    },
  },
  {
    id: "return_to_sender_wrong_admin",
    source: "tests.js",
    helios: { group: "RETURN_TO_SENDER", name: "wrong admin signer" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_return_to_sender_uses_settings_admin_gate",
    },
  },
  {
    id: "return_to_sender_forbidden_token",
    source: "tests.js",
    helios: {
      group: "RETURN_TO_SENDER",
      name: "can't return a handle reference token",
    },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_return_to_sender_rejects_forbidden_assets",
    },
  },
  {
    id: "return_to_sender_all_good",
    source: "tests.js",
    helios: { group: "RETURN_TO_SENDER", name: "all good" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_return_to_sender_uses_settings_admin_gate",
    },
  },
  {
    id: "personalize_main_happy_path",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "main" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_redeemer_personalize_branch_uses_personalize_rules",
    },
  },
  {
    id: "personalize_handle_redeemer_mismatch",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "handle redeemer mismatch" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_common_and_virtual_gates",
    },
  },
  {
    id: "personalize_handle_missing",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "handle missing" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_common_and_virtual_gates",
    },
  },
  {
    id: "personalize_policy_root_gate",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "bg_policy_ids missing" },
    aiken: {
      module: "personalization/personalize_mpf_context",
      test: "load_policy_index_root_enforces_expected_token_suffix",
    },
  },
  {
    id: "personalize_immutables_changed",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "immutables changed" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_rejects_contract_or_policy_failures",
    },
  },
  {
    id: "personalize_agreed_terms_changed",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "agreed terms changed" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_rejects_contract_or_policy_failures",
    },
  },
  {
    id: "personalize_bg_image_mismatch",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "bg_asset and bg_image mismatch" },
    aiken: {
      module: "personalization/personalize_policy_approval",
      test: "policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches",
    },
  },
  {
    id: "personalize_pfp_image_mismatch",
    source: "tests.js",
    helios: { group: "PERSONALIZE", name: "pfp_asset and pfp_image mismatch" },
    aiken: {
      module: "personalization/personalize_policy_approval",
      test: "policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches",
    },
  },
  {
    id: "reset_happy_path",
    source: "tests.js",
    helios: { group: "RESET", name: "no admin signer, pfp mismatch" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "reset_not_allowed_when_good",
    source: "tests.js",
    helios: { group: "RESET", name: "reset not allowed because all good" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "reset_socials_holder_change",
    source: "tests.js",
    helios: { group: "RESET", name: "socials must reset when holder changes" },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "reset_resolved_holder_change",
    source: "tests.js",
    helios: {
      group: "RESET",
      name: "resolved addresses must reset when holder changes",
    },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "reset_socials_unauthorized",
    source: "tests.js",
    helios: {
      group: "RESET",
      name: "socials cannot be reset without authorization",
    },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "reset_resolved_unauthorized",
    source: "tests.js",
    helios: {
      group: "RESET",
      name: "resolved addresses cannot be reset without authorization",
    },
    aiken: {
      module: "personalization/update",
      test: "personalize_is_valid_reset_privacy_and_authorization_branches",
    },
  },
  {
    id: "tx_update_private_mint_address_changed",
    source: "txTests.ts",
    enabled: false,
    skip_reason:
      "txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses",
    helios: { group: "UPDATE", name: "private mint address changed" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_update_branch_accepts_private_root_address_change",
    },
  },
  {
    id: "tx_update_protocol_settings_token_required",
    source: "txTests.ts",
    enabled: false,
    skip_reason:
      "txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses",
    helios: { group: "UPDATE", name: "protocol settings token required" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_update_branch_requires_settings_tokens",
    },
  },
  {
    id: "tx_revoke_private_mint_signed_by_root",
    source: "txTests.ts",
    enabled: false,
    skip_reason:
      "txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses",
    helios: { group: "REVOKE", name: "private mint and signed by root" },
    aiken: {
      module: "personalization/update",
      test: "dispatch_from_tx_revoke_branch_uses_mint_burn_quantity",
    },
  },
  {
    id: "tx_revoke_public_not_expired",
    source: "txTests.ts",
    enabled: false,
    skip_reason:
      "txTests.ts depends on upstream datum-conversion endpoint with intermittent 503 responses",
    helios: { group: "REVOKE", name: "public mint not expired" },
    aiken: {
      module: "personalization/revoke",
      test: "revoke_is_valid_rejects_public_not_expired",
    },
  },
];

export function stripAnsi(value) {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

export function parseHeliosResultLines(output) {
  const lines = stripAnsi(output).split(/\r?\n/);
  const parsed = [];

  for (const line of lines) {
    const match =
      /\*(success|failure)\* - (APPROVE|DENY)\s+- ([A-Z_]+)\s+(.+)$/.exec(
        line,
      );

    if (!match) continue;

    let name = match[4].trim();
    if (name.startsWith("'") && name.endsWith("'") && name.length >= 2) {
      name = name.slice(1, -1);
    }

    parsed.push({
      status: match[1],
      expected: match[2],
      group: match[3],
      name,
      key: `${match[3]}::${name}`,
    });
  }

  return parsed;
}

export function parseAikenJsonReport(rawOutput) {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("Aiken report JSON not found in output");
  }

  return JSON.parse(rawOutput.slice(start, end + 1));
}

function runCommand(cmd, cwd = process.cwd()) {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function runHeliosReport() {
  const output = runCommand(HELIOS_CMD);
  const scenarios = parseHeliosResultLines(output);
  const byKey = new Map(scenarios.map((entry) => [entry.key, entry]));

  return { byKey, count: scenarios.length };
}

function runAikenReports() {
  const byModule = new Map();

  for (const moduleName of AIKEN_MODULES) {
    const output = runCommand(
      `aiken check -m ${moduleName} --trace-level silent`,
      path.resolve("aiken"),
    );
    const report = parseAikenJsonReport(output);
    const module = report.modules.find((entry) => entry.name === moduleName);

    if (!module) {
      throw new Error(`Aiken module not found in report: ${moduleName}`);
    }

    byModule.set(
      moduleName,
      new Map(module.tests.map((entry) => [entry.title, entry.status])),
    );
  }

  return byModule;
}

function evaluateParity(heliosReport, aikenReports) {
  const rows = PARITY_MATRIX.map((entry) => {
    const enabled = entry.enabled !== false;
    const heliosKey = `${entry.helios.group}::${entry.helios.name}`;
    const heliosScenario = heliosReport.byKey.get(heliosKey);
    const aikenModule = aikenReports.get(entry.aiken.module);
    const aikenStatus = aikenModule?.get(entry.aiken.test) ?? "missing";

    const heliosPass = heliosScenario?.status === "success";
    const aikenPass = aikenStatus === "pass";
    const pass = enabled && heliosPass && aikenPass;

    return {
      id: entry.id,
      source: entry.source ?? "tests.js",
      enabled,
      skip_reason: entry.skip_reason ?? null,
      pass,
      helios: {
        group: entry.helios.group,
        name: entry.helios.name,
        found: Boolean(heliosScenario),
        status: heliosScenario?.status ?? "missing",
      },
      aiken: {
        module: entry.aiken.module,
        test: entry.aiken.test,
        status: aikenStatus,
      },
    };
  });

  const executableRows = rows.filter((row) => row.enabled);
  const skippedRows = rows.filter((row) => !row.enabled);

  return {
    total: rows.length,
    executable_total: executableRows.length,
    skipped_total: skippedRows.length,
    passed: executableRows.filter((row) => row.pass).length,
    failed: executableRows.filter((row) => !row.pass).length,
    rows,
  };
}

function writeReportFiles(report) {
  const reportDir = path.resolve("tests/reports");
  fs.mkdirSync(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, "parity-report.json");
  const mdPath = path.join(reportDir, "parity-report.md");
  const generatedAt = new Date().toISOString();
  const payload = { generated_at: generatedAt, ...report };

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines = [
    "# Helios vs Aiken Parity Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Summary: ${report.passed}/${report.executable_total} executable mapped branch intents passed`,
    `Skipped vectors: ${report.skipped_total}`,
    "",
    "| ID | Source | Helios | Aiken | Status |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const row of report.rows) {
    const heliosCell = `${row.helios.group} / ${row.helios.name} (${row.helios.status})`;
    const aikenCell = `${row.aiken.module} / ${row.aiken.test} (${row.aiken.status})`;
    const status = row.enabled ? (row.pass ? "pass" : "fail") : `skipped: ${row.skip_reason}`;
    lines.push(`| ${row.id} | ${row.source} | ${heliosCell} | ${aikenCell} | ${status} |`);
  }

  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, mdPath };
}

export function runParity() {
  const heliosReport = runHeliosReport();
  const aikenReports = runAikenReports();
  const report = evaluateParity(heliosReport, aikenReports);
  const reportPaths = writeReportFiles(report);

  return { report, reportPaths, heliosCount: heliosReport.count };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report, reportPaths, heliosCount } = runParity();

  console.log(
    `Parity mapped intents: ${report.passed}/${report.executable_total} executable (${report.skipped_total} skipped, legacy helios scenarios parsed: ${heliosCount})`,
  );
  console.log(`Report JSON: ${path.relative(process.cwd(), reportPaths.jsonPath)}`);
  console.log(`Report MD: ${path.relative(process.cwd(), reportPaths.mdPath)}`);

  if (report.failed > 0) {
    process.exit(1);
  }
}

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

function runAikenCheck(moduleFilter) {
  const stdout = execSync(
    `aiken check -m ${moduleFilter} --trace-level silent`,
    {
      cwd: "./aiken",
      encoding: "utf8",
    },
  );

  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "expected JSON output from aiken check");

  return JSON.parse(stdout.slice(start, end + 1));
}

function getExecutionUnits(report, moduleName, testTitle) {
  const module = report.modules.find((entry) => entry.name === moduleName);
  assert.ok(module, `missing module: ${moduleName}`);

  const testCase = module.tests.find((entry) => entry.title === testTitle);
  assert.ok(testCase, `missing test: ${testTitle}`);

  return testCase.execution_units;
}

test("Aiken MPF verification cost stays within guard rails", () => {
  const report = runAikenCheck("personalization/policy_index_mpf");

  const limits = [
    {
      title: "verify_policy_approval_accepts_valid_bg_proof",
      mem: 100000,
      cpu: 41000000,
    },
    {
      title: "verify_policy_approval_rejects_bad_proof",
      mem: 165000,
      cpu: 64000000,
    },
    {
      title: "verify_policy_approval_rejects_policy_mismatch",
      mem: 55000,
      cpu: 22000000,
    },
  ];

  for (const limit of limits) {
    const units = getExecutionUnits(
      report,
      "personalization/policy_index_mpf",
      limit.title,
    );

    assert.ok(
      units.mem <= limit.mem,
      `${limit.title} mem regression: ${units.mem} > ${limit.mem}`,
    );
    assert.ok(
      units.cpu <= limit.cpu,
      `${limit.title} cpu regression: ${units.cpu} > ${limit.cpu}`,
    );
  }
});

test("Aiken update + personalize + dispatch helper cost stays within guard rails", () => {
  const report = runAikenCheck("personalization/update");

  const limits = [
    {
      title: "update_is_valid_private_root_signed_branch",
      mem: 175000,
      cpu: 76000000,
    },
    {
      title: "update_is_valid_public_root_signed_expired_branch",
      mem: 155000,
      cpu: 68000000,
    },
    {
      title: "update_is_valid_assignee_branch",
      mem: 330000,
      cpu: 142000000,
    },
    {
      title: "dispatch_redeemer_return_to_sender_branch",
      mem: 125000,
      cpu: 36000000,
    },
    {
      title: "dispatch_redeemer_migrate_branch_enforces_owner_requirement",
      mem: 135000,
      cpu: 46000000,
    },
    {
      title: "dispatch_redeemer_revoke_branch_uses_revoke_rules",
      mem: 100000,
      cpu: 34000000,
    },
    {
      title: "dispatch_redeemer_update_branch_cost_probe",
      mem: 95000,
      cpu: 33000000,
    },
    {
      title: "personalize_is_valid_non_reset_cost_probe",
      mem: 220000,
      cpu: 90000000,
    },
    {
      title: "personalize_is_valid_reset_cost_probe",
      mem: 280000,
      cpu: 115000000,
    },
    {
      title: "dispatch_redeemer_personalize_branch_cost_probe",
      mem: 260000,
      cpu: 110000000,
    },
    {
      title: "dispatch_from_tx_return_to_sender_uses_settings_admin_gate",
      mem: 350000,
      cpu: 110000000,
    },
    {
      title: "dispatch_from_tx_return_to_sender_rejects_forbidden_assets",
      mem: 230000,
      cpu: 70000000,
    },
    {
      title: "dispatch_from_tx_migrate_branch_respects_owner_sig_requirement",
      mem: 650000,
      cpu: 210000000,
    },
    {
      title: "dispatch_from_tx_revoke_branch_uses_mint_burn_quantity",
      mem: 620000,
      cpu: 200000000,
    },
    {
      title: "dispatch_from_tx_update_branch_requires_settings_tokens",
      mem: 380000,
      cpu: 120000000,
    },
    {
      title: "dispatch_from_tx_update_branch_accepts_private_root_address_change",
      mem: 1150000,
      cpu: 360000000,
    },
    {
      title: "dispatch_from_tx_personalize_branch_is_wired_through_context_parser",
      mem: 560000,
      cpu: 190000000,
    },
  ];

  for (const limit of limits) {
    const units = getExecutionUnits(
      report,
      "personalization/update",
      limit.title,
    );

    assert.ok(
      units.mem <= limit.mem,
      `${limit.title} mem regression: ${units.mem} > ${limit.mem}`,
    );
    assert.ok(
      units.cpu <= limit.cpu,
      `${limit.title} cpu regression: ${units.cpu} > ${limit.cpu}`,
    );
  }
});

test("Aiken personalize MPF-context helper cost stays within guard rails", () => {
  const report = runAikenCheck("personalization/personalize_mpf_context");

  const limits = [
    {
      title: "load_policy_index_root_accepts_bg_and_pfp_suffixes",
      mem: 190000,
      cpu: 65000000,
    },
    {
      title: "approval_status_for_asset_accepts_precomputed_bg_and_pfp_proofs",
      mem: 400000,
      cpu: 135000000,
    },
    {
      title: "approval_status_for_asset_rejects_missing_proof_for_non_empty_asset",
      mem: 55000,
      cpu: 21000000,
    },
  ];

  for (const limit of limits) {
    const units = getExecutionUnits(
      report,
      "personalization/personalize_mpf_context",
      limit.title,
    );

    assert.ok(
      units.mem <= limit.mem,
      `${limit.title} mem regression: ${units.mem} > ${limit.mem}`,
    );
    assert.ok(
      units.cpu <= limit.cpu,
      `${limit.title} cpu regression: ${units.cpu} > ${limit.cpu}`,
    );
  }
});

test("Aiken policy-datum helper cost stays within guard rails", () => {
  const report = runAikenCheck("personalization/personalize_policy_approval");

  const limits = [
    {
      title: "policy_datum_is_valid_accepts_valid_flags_and_image_rules",
      mem: 73000,
      cpu: 28000000,
    },
    {
      title: "policy_datum_is_valid_rejects_bg_and_pfp_image_mismatches",
      mem: 112000,
      cpu: 40000000,
    },
  ];

  for (const limit of limits) {
    const units = getExecutionUnits(
      report,
      "personalization/personalize_policy_approval",
      limit.title,
    );

    assert.ok(
      units.mem <= limit.mem,
      `${limit.title} mem regression: ${units.mem} > ${limit.mem}`,
    );
    assert.ok(
      units.cpu <= limit.cpu,
      `${limit.title} cpu regression: ${units.cpu} > ${limit.cpu}`,
    );
  }
});

test("Aiken personalize-base helper cost stays within guard rails", () => {
  const report = runAikenCheck("personalization/personalize_base");

  const limits = [
    {
      title: "fees_are_paid_matches_grace_and_payment_rules",
      mem: 80000,
      cpu: 28000000,
    },
    {
      title: "reset_privacy_is_valid_matches_holder_change_requirements",
      mem: 70000,
      cpu: 26000000,
    },
  ];

  for (const limit of limits) {
    const units = getExecutionUnits(
      report,
      "personalization/personalize_base",
      limit.title,
    );

    assert.ok(
      units.mem <= limit.mem,
      `${limit.title} mem regression: ${units.mem} > ${limit.mem}`,
    );
    assert.ok(
      units.cpu <= limit.cpu,
      `${limit.title} cpu regression: ${units.cpu} > ${limit.cpu}`,
    );
  }
});

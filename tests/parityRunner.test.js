import test from "node:test";
import assert from "node:assert/strict";
import { parseAikenJsonReport, parseHeliosResultLines, stripAnsi } from "./parityRunner.js";

test("stripAnsi removes terminal color escapes", () => {
  const withAnsi = "\u001b[32m*success*\u001b[0m";
  assert.equal(stripAnsi(withAnsi), "*success*");
});

test("parseHeliosResultLines extracts group/name/status tuples", () => {
  const sample = `
\u001b[32m*success* - APPROVE - PERSONALIZE               'main'\u001b[0m
\u001b[31m*failure* - DENY    - MIGRATE                   'admin, no owner'\u001b[0m
`;
  const rows = parseHeliosResultLines(sample);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    status: "success",
    expected: "APPROVE",
    group: "PERSONALIZE",
    name: "main",
    key: "PERSONALIZE::main",
  });
  assert.deepEqual(rows[1], {
    status: "failure",
    expected: "DENY",
    group: "MIGRATE",
    name: "admin, no owner",
    key: "MIGRATE::admin, no owner",
  });
});

test("parseAikenJsonReport locates embedded JSON payload", () => {
  const sample = `
Compiling...
{"summary":{"total":1},"modules":[{"name":"personalization/update","tests":[{"title":"t","status":"pass"}]}]}
Done.
`;
  const report = parseAikenJsonReport(sample);

  assert.equal(report.summary.total, 1);
  assert.equal(report.modules[0].name, "personalization/update");
  assert.equal(report.modules[0].tests[0].status, "pass");
});

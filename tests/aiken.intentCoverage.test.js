import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const branchCoverage = readFileSync("./docs/spec/branch-coverage.md", "utf8");
const allowedStatuses = new Set([
  "covered",
  "covered-legacy-parity",
  "covered-conditional",
]);

function extractAikenCoverageRows(markdown) {
  const sectionStart = markdown.indexOf("## Aiken Intent Coverage");
  assert.ok(sectionStart >= 0, "Aiken Intent Coverage section is missing");

  const nextSection = markdown.indexOf("\n## ", sectionStart + 1);
  const section =
    nextSection >= 0
      ? markdown.slice(sectionStart, nextSection)
      : markdown.slice(sectionStart);

  return section
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      return {
        intent: cells[0] ?? "",
        status: cells[1] ?? "",
        aikenCoverage: cells[2] ?? "",
        parityMapping: cells[3] ?? "",
      };
    })
    .filter((row) => row.intent.length > 0);
}

test("Aiken branch-intent matrix has no missing reachable intents", () => {
  const rows = extractAikenCoverageRows(branchCoverage);
  assert.ok(rows.length > 0, "No Aiken coverage rows found");

  for (const row of rows) {
    assert.equal(
      allowedStatuses.has(row.status),
      true,
      `Unexpected/missing status for intent '${row.intent}': ${row.status}`,
    );
  }
});

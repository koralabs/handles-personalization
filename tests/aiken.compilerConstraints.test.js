import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const probeModulePath = path.resolve(
  "./aiken/lib/personalization/compiler_probe_bug.ak",
);
const probeModuleName = "personalization/compiler_probe_bug";

function aikenVersion() {
  const result = spawnSync("aiken", ["--version"], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`failed to read aiken version: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function runProbe(source) {
  fs.writeFileSync(probeModulePath, source);

  try {
    const result = spawnSync(
      "aiken",
      ["check", "-m", probeModuleName, "--trace-level", "silent"],
      { cwd: "./aiken", encoding: "utf8" },
    );

    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  } finally {
    fs.rmSync(probeModulePath, { force: true });
  }
}

test("compiler-safe Option<Data> projection to Int compiles", () => {
  const result = runProbe(`
pub fn projection(data_opt: Option<Data>) -> Int {
  when data_opt is {
    Some(_) -> 1
    None -> 0
  }
}

test projection_probe_compiles() {
  projection(None) == 0
}
`);

  assert.equal(result.status, 0);
  assert.match(result.output, /Collecting all tests scenarios/);
});

test("Aiken v1.1.21 reproduces silent-exit on Option<Data> fallback returning Data", (t) => {
  const version = aikenVersion();

  if (!version.includes("v1.1.21")) {
    t.skip(`probe pinned to v1.1.21 behavior, got ${version}`);
    return;
  }

  const result = runProbe(`
pub fn unwrap_or_empty(data_opt: Option<Data>) -> Data {
  when data_opt is {
    Some(data) -> data
    None -> ""
  }
}

test option_data_fallback_probe() {
  unwrap_or_empty(None) == ""
}
`);

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Compiling koralabs\/handles-personalization/);
  assert.ok(!/Collecting all tests scenarios/.test(result.output));
  assert.ok(!/error:/i.test(result.output));
});

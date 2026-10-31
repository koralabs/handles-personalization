import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { parseDesiredDeploymentState } from "../deploymentState.js";

// Feature: a malformed desired deployment state is refused with an error naming the bad field,
// before any planner/deployer code compares it to live chain state.
// Failure mode: a typo'd or mistyped YAML field silently normalizes (e.g. a string fee, a slug with
// "-", a non-string provider) and the plan diffs against a wrong desired settings datum.
// Negative control: removing any one validator (e.g. the `-` check in requireShortHandleSlug, or the
// value check in requireStringRecord) makes its row below stop throwing and the test fail.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.resolve(__dirname, "../deploy/preview/personalization.yaml"), "utf8");
const base = () => YAML.parse(fixture);
const settings = (doc) => doc.settings.values["pers@handle_settings"];

const cases = [
  ["invalid YAML", () => "a: [", /is not valid YAML/],
  ["non-object root", () => YAML.stringify([1, 2]), /must be a YAML object/],
  ["wrong schema_version", (d) => { d.schema_version = 2; }, /schema_version must equal 3/],
  ["string schema_version", (d) => { d.schema_version = "3"; }, /numeric field `schema_version`/],
  ["unknown network", (d) => { d.network = "testnet"; }, /network must be one of/],
  ["bad subhandle format", (d) => { d.subhandle_strategy.format = "x"; }, /format must be contract_slug_ordinal/],
  ["empty contracts", (d) => { d.contracts = []; }, /non-empty array field `contracts`/],
  ["contract not an object", (d) => { d.contracts[0] = "persdsg"; }, /contracts\[0\] must be a YAML object/],
  ["slug with dash", (d) => { const c = d.contracts[0]; c.contract_slug = c.script_type = c.deployment_handle_slug = "pers-dsg"; }, /must not include "-"/],
  ["slug too long", (d) => { const c = d.contracts[0]; c.contract_slug = c.script_type = c.deployment_handle_slug = "persdsgxxxx"; }, /10 characters or fewer/],
  ["mismatched slugs", (d) => { d.contracts[0].script_type = "perslfc"; }, /must match/],
  ["bad build kind", (d) => { d.contracts[0].build.kind = "spend"; }, /kind must be validator or minting_policy/],
  ["missing build parameters", (d) => { delete d.contracts[0].build.parameters; }, /object field `parameters`/],
  ["empty old_script_type", (d) => { d.contracts[0].old_script_type = " "; }, /string field `old_script_type`/],
  ["string treasury_fee", (d) => { settings(d).treasury_fee = "1"; }, /numeric field `treasury_fee`/],
  ["non-string provider", (d) => { settings(d).pz_providers = { a: 1 }; }, /pz_providers must include string values/],
  ["valid_contracts not array", (d) => { settings(d).valid_contracts = "x"; }, /array field `valid_contracts`/],
  ["empty admin_creds entry", (d) => { settings(d).admin_creds = [""]; }, /string array field `admin_creds`/],
];

for (const [name, mutate, expected] of cases) {
  test(`rejects desired state: ${name}`, () => {
    const doc = base();
    const out = mutate(doc);
    const raw = typeof out === "string" ? out : YAML.stringify(doc);
    assert.throws(() => parseDesiredDeploymentState(raw, "fixture"), expected);
  });
}

test("trims and sorts provider records and keeps the unmodified fixture valid", () => {
  const doc = base();
  settings(doc).pz_providers = { " zz ": " b ", aa: "a" };
  const state = parseDesiredDeploymentState(YAML.stringify(doc), "fixture");
  const parsed = JSON.stringify(state);
  assert.ok(parsed.includes('"pz_providers":{"aa":"a","zz":"b"}'), parsed.slice(0, 400));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = readFileSync("./contract.helios", "utf8");
const legacyTests = readFileSync("./tests/tests.js", "utf8");
const txTests = readFileSync("./tests/txTests.ts", "utf8");
const allTests = `${legacyTests}\n${txTests}`;

const assertMessages = [
  ...contract.matchAll(/assert\([\s\S]*?,\s*"([^"]+)"\)/g),
].map((m) => m[1]);
const errorMessages = [...contract.matchAll(/error\("([^"]+)"\)/g)].map(
  (m) => m[1]
);

const reachableMessageExemptions = new Set([
  "Contract failed validation",
  "Invalid input datum",
  "Personalization settings checks failed",
]);

test("contract assertion/error messages are covered by tests or marked unreachable", () => {
  const messages = [...new Set([...assertMessages, ...errorMessages])].sort();

  for (const message of messages) {
    const covered = allTests.includes(message);
    const exempted = reachableMessageExemptions.has(message);
    assert.equal(
      covered || exempted,
      true,
      `Missing message coverage for: ${message}`
    );
  }
});


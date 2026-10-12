import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { submitTx } from "../helpers/cardano-sdk/submitTx.js";

const TX_HASH = "ab".repeat(32);
const submission = {
  network: "preview",
  signedTxCborHex: "8200",
  blockfrostApiKey: "test-project-key",
};

test("submits exact CBOR bytes and returns the transaction hash", async (t) => {
  // Feature: submission sends binary CBOR to the selected network and returns its hash.
  // Failure: a hex-text body, wrong endpoint, or untrimmed response breaks submission.
  // Negative control: removing prefix stripping or quote trimming fails these cases.
  for (const signedTxCborHex of ["8200", "0x8200"]) {
    await t.test(signedTxCborHex, async () => {
      const requests = [];
      const result = await submitTx({
        ...submission,
        signedTxCborHex,
        fetchFn: async (url, options) => {
          requests.push({ url, options });
          return new Response(`  "${TX_HASH}"\n`);
        },
      });
      assert.equal(result, TX_HASH);
      assert.deepEqual(requests, [{
        url: "https://cardano-preview.blockfrost.io/api/v0/tx/submit",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/cbor", project_id: "test-project-key" },
          body: Buffer.from([0x82, 0x00]),
        },
      }]);
    });
  }
});

test("rejects missing submission parameters before sending a request", async (t) => {
  // Feature: required submission inputs are validated before any network activity.
  // Failure: an incomplete submission reaches Blockfrost or reports the wrong error.
  // Negative control: deleting any required-input guard fails its error assertion.
  for (const field of ["network", "signedTxCborHex", "blockfrostApiKey"]) {
    await t.test(field, async () => {
      let requests = 0;
      await assert.rejects(submitTx({
        ...submission,
        [field]: "",
        fetchFn: async () => {
          requests++;
          return new Response(`"${TX_HASH}"`);
        },
      }), { message: `submitTx: ${field} is required` });
      assert.equal(requests, 0);
    });
  }
});

test("preserves Blockfrost rejection status and diagnostic body", async () => {
  // Feature: failed submissions report the server's status and rejection reason.
  // Failure: a rejected transaction is returned as a hash or loses its diagnostic.
  // Negative control: bypassing response.ok or omitting its body fails this assertion.
  await assert.rejects(submitTx({
    ...submission,
    fetchFn: async () => new Response("BadInputsUTxO", { status: 400 }),
  }), { message: "Blockfrost /tx/submit failed: HTTP 400 — BadInputsUTxO" });
});

test("reports the HTTP failure even when its body cannot be read", async () => {
  // Feature: an unreadable error body does not hide the submission's HTTP failure.
  // Failure: a body-stream error replaces the useful server status.
  // Negative control: removing the text-read catch exposes the stream error instead.
  await assert.rejects(submitTx({
    ...submission,
    fetchFn: async () => ({
      ok: false,
      status: 503,
      text: async () => { throw new Error("stream closed"); },
    }),
  }), { message: "Blockfrost /tx/submit failed: HTTP 503 — (no body)" });
});

test("rejects successful responses that are not lowercase 32-byte hashes", async (t) => {
  // Feature: callers only receive a valid transaction hash after successful submission.
  // Failure: a malformed success body is mistaken for a transaction identifier.
  // Negative control: removing the hash-format guard makes these rejections fail.
  for (const body of ["", `"${"a".repeat(63)}"`, `"${"g".repeat(64)}"`, `"${"AB".repeat(32)}"`, '{"hash":"unexpected"}']) {
    await t.test(JSON.stringify(body), async () => {
      await assert.rejects(submitTx({
        ...submission,
        fetchFn: async () => new Response(body),
      }), /Blockfrost \/tx\/submit returned unexpected body:/);
    });
  }
});

test("propagates transport failures to the caller", async () => {
  // Feature: a network failure cannot be reported as a successful submission.
  // Failure: transport errors are swallowed or converted to a false success.
  // Negative control: catching the fetch error and returning a value fails rejects.
  const error = new Error("connection reset");
  await assert.rejects(submitTx({
    ...submission,
    fetchFn: async () => { throw error; },
  }), (actual) => actual === error);
});

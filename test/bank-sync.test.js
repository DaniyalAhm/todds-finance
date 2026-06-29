const assert = require("node:assert/strict");
const test = require("node:test");

const { validateBankSyncRequest } = require("../server/routes/actual");

test("bank sync defaults to all open accounts", () => {
  assert.deepEqual(validateBankSyncRequest(undefined), { value: null });
  assert.deepEqual(validateBankSyncRequest({}), { value: null });
});

test("bank sync account IDs are trimmed and deduplicated", () => {
  assert.deepEqual(validateBankSyncRequest({ accountIds: [" a1 ", "a2", "a1"] }), {
    value: ["a1", "a2"],
  });
});

test("bank sync rejects invalid account ID payloads", () => {
  assert.match(validateBankSyncRequest({ accountIds: "a1" }).error, /must be an array/);
  assert.match(validateBankSyncRequest({ accountIds: [123] }).error, /non-empty string/);
});

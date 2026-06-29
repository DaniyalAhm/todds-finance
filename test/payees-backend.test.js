const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMergeSuggestions,
  toPublicPayee,
  validateMergeBatchRequest,
  validateMergeRequest,
} = require("../server/routes/payees");
const { sendPayeesToFlask } = require("../server/services/flask.service");

assert.equal(typeof sendPayeesToFlask, "function");

test("payees are normalized for the frontend", () => {
  assert.deepEqual(toPublicPayee({ id: "p1", name: "Coffee Shop" }), {
    id: "p1",
    name: "Coffee Shop",
    transferAccountId: null,
    isTransfer: false,
  });

  assert.deepEqual(toPublicPayee({ id: 42, name: "Transfer", transfer_acct: "account-1" }), {
    id: "42",
    name: "Transfer",
    transferAccountId: "account-1",
    isTransfer: true,
  });
});

test("valid merge plans are trimmed and deduplicated", () => {
  assert.deepEqual(
    validateMergeRequest({
      targetPayeeId: " target ",
      sourcePayeeIds: [" source-1 ", "source-2", "source-1"],
    }),
    {
      value: {
        targetPayeeId: "target",
        sourcePayeeIds: ["source-1", "source-2"],
      },
    }
  );
});

test("invalid merge plans return actionable errors", () => {
  assert.match(validateMergeRequest(null).error, /JSON object/);
  assert.match(validateMergeRequest({ sourcePayeeIds: [] }).error, /targetPayeeId/);
  assert.match(validateMergeRequest({ targetPayeeId: "p1" }).error, /must be an array/);
  assert.match(
    validateMergeRequest({ targetPayeeId: "p1", sourcePayeeIds: [] }).error,
    /at least one/
  );
  assert.match(
    validateMergeRequest({ targetPayeeId: "p1", sourcePayeeIds: ["p1"] }).error,
    /cannot also be a source/
  );
  assert.match(
    validateMergeRequest({ targetPayeeId: "p1", sourcePayeeIds: [123] }).error,
    /non-empty string/
  );
});

test("Splink cluster rows become non-transfer merge suggestion trees", () => {
  const payees = [
    toPublicPayee({ id: "p1", name: "Coffee Shop" }),
    toPublicPayee({ id: "p2", name: "Coffee Shop #42" }),
    toPublicPayee({ id: "p3", name: "Unrelated" }),
    toPublicPayee({ id: "p4", name: "Transfer", transfer_acct: "a1" }),
  ];
  const suggestions = buildMergeSuggestions(
    {
      clusters: [
        { cluster_id: 1, unique_id: "p1", name: "Coffee Shop" },
        { cluster_id: 1, unique_id: "p2", name: "Coffee Shop #42" },
        { cluster_id: 2, unique_id: "p3", name: "Unrelated" },
        { cluster_id: 2, unique_id: "p4", name: "Transfer" },
      ],
    },
    payees
  );

  assert.deepEqual(suggestions, [
    {
      id: "cluster-1",
      clusterId: "1",
      suggestedTargetId: "p1",
      members: [
        { id: "p1", name: "Coffee Shop", transferAccountId: null, isTransfer: false },
        { id: "p2", name: "Coffee Shop #42", transferAccountId: null, isTransfer: false },
      ],
    },
  ]);
});

test("merge batches reject overlapping groups", () => {
  assert.deepEqual(
    validateMergeBatchRequest({
      merges: [
        { targetPayeeId: "p1", sourcePayeeIds: ["p2"] },
        { targetPayeeId: "p3", sourcePayeeIds: ["p4"] },
      ],
    }),
    {
      value: [
        { targetPayeeId: "p1", sourcePayeeIds: ["p2"] },
        { targetPayeeId: "p3", sourcePayeeIds: ["p4"] },
      ],
    }
  );

  assert.match(
    validateMergeBatchRequest({
      merges: [
        { targetPayeeId: "p1", sourcePayeeIds: ["p2"] },
        { targetPayeeId: "p2", sourcePayeeIds: ["p3"] },
      ],
    }).error,
    /more than one merge suggestion/
  );
});

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCycleSummary,
  parseInsightContent,
  validateCycleDays,
} = require("../server/lib/insights");

test("cycle summaries include only filtered non-transfer transactions", () => {
  const summary = buildCycleSummary({
    accounts: [{ id: "a1", name: "Checking" }],
    transactionsByAccount: new Map([
      [
        "a1",
        [
          { date: "2026-01-01", amount: 100000, starting_balance_flag: true },
          { date: "2026-01-10", amount: 20000, payee: "salary" },
          { date: "2026-01-11", amount: -5000, payee: "store", category: "food" },
          { date: "2026-01-12", amount: -9000, transfer_id: "transfer" },
          { date: "2025-12-01", amount: -7000 },
        ],
      ],
    ]),
    payees: [
      { id: "salary", name: "Employer" },
      { id: "store", name: "Market" },
    ],
    categories: [{ id: "food", name: "Groceries" }],
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  });

  assert.equal(summary.transactionCount, 2);
  assert.deepEqual(summary.totals, { income: 20000, spending: 5000, net: 15000 });
  assert.deepEqual(summary.topSpendingCategories, [{ name: "Groceries", amount: 5000 }]);
  assert.deepEqual(summary.topSpendingPayees, [{ name: "Market", amount: 5000 }]);
});

test("Open WebUI insight JSON is normalized", () => {
  assert.deepEqual(
    parseInsightContent('```json\n{"summary":"Solid cycle","glows":[{"title":"Savings","detail":"Net positive"}],"grows":["Dining"]}\n```'),
    {
      summary: "Solid cycle",
      glows: [{ title: "Savings", detail: "Net positive" }],
      grows: [{ title: "Dining", detail: "" }],
    }
  );
});

test("cycle insight timeline accepts dashboard periods only", () => {
  assert.deepEqual(validateCycleDays(180), { value: 180 });
  assert.match(validateCycleDays(45).error, /30, 90, 180, or 365/);
});

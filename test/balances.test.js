const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertEndingBalances,
  buildRunningBalanceData,
  createDateRange,
  flattenBalanceTransactions,
  getDateWindow,
  getLatestTransactionDate,
  toCutoffDate,
} = require("../server/lib/balances");

test("date ranges and cutoff dates are UTC-stable", () => {
  assert.deepEqual(createDateRange("2026-01-01", "2026-01-03"), [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
  ]);
  assert.equal(toCutoffDate("2026-01-01").toISOString(), "2026-01-01T12:00:00.000Z");
  assert.deepEqual(getDateWindow(3, new Date("2026-01-10T22:00:00Z")), {
    startDate: "2026-01-08",
    endDate: "2026-01-10",
  });
});

test("split parents are replaced by their balance-bearing children", () => {
  const transactions = [
    { id: "normal", amount: 100 },
    {
      id: "parent",
      is_parent: true,
      amount: -200,
      subtransactions: [
        { id: "child-1", is_child: true, amount: -75 },
        { id: "child-2", is_child: true, amount: -125 },
      ],
    },
  ];
  assert.deepEqual(
    flattenBalanceTransactions(transactions).map((transaction) => transaction.id),
    ["normal", "child-1", "child-2"]
  );
});

test("running balances roll forward from each account starting balance", () => {
  const accounts = [
    { id: "a1", name: "Card one", offbudget: false },
    { id: "a2", name: "Card two", offbudget: true },
  ];
  const transactions = new Map([
    [
      "a1",
      [
        { id: "start-1", date: "2026-01-01", amount: 1000, starting_balance_flag: true },
        { id: "deposit", date: "2026-01-02", amount: 500 },
        {
          id: "split-parent",
          date: "2026-01-03",
          amount: -200,
          is_parent: true,
          subtransactions: [
            { id: "split-1", date: "2026-01-03", amount: -100, is_child: true },
            { id: "split-2", date: "2026-01-03", amount: -100, is_child: true },
          ],
        },
      ],
    ],
    [
      "a2",
      [
        { id: "start-2", date: "2025-12-31", amount: 200, starting_balance_flag: true },
        { id: "deposit-2", date: "2026-01-01", amount: 100 },
      ],
    ],
  ]);

  const result = buildRunningBalanceData(
    accounts,
    transactions,
    "2026-01-02",
    "2026-01-03"
  );

  assert.equal(result.accounts[0].startingBalance, 1000);
  assert.equal(result.accounts[0].startingBalanceDate, "2026-01-01");
  assert.equal(result.accounts[0].openingBalance, 1000);
  assert.deepEqual(result.accounts[0].series.map((point) => point.balance), [1500, 1300]);
  assert.deepEqual(result.merged.series.map((point) => point.balance), [1800, 1600]);
  assert.equal(result.merged.openingBalance, 1300);
  assert.equal(result.merged.periodChange, 300);
});

test("calculated ending balances must match Actual", () => {
  const balanceData = {
    accounts: [
      { id: "a1", currentBalance: 1300 },
      { id: "a2", currentBalance: 300 },
    ],
  };
  assert.doesNotThrow(() =>
    assertEndingBalances(balanceData, new Map([["a1", 1300], ["a2", 300]]))
  );
  assert.throws(
    () => assertEndingBalances(balanceData, new Map([["a1", 1299], ["a2", 300]])),
    /validation failed/
  );
});

test("latest graph date comes from getTransactions results", () => {
  const transactions = new Map([
    ["a1", [{ date: "2026-06-28", amount: 100 }]],
    [
      "a2",
      [
        {
          date: "2026-06-29",
          is_parent: true,
          subtransactions: [{ date: "2026-06-30", amount: 200, is_child: true }],
        },
      ],
    ],
  ]);
  assert.equal(getLatestTransactionDate(transactions), "2026-06-30");
});

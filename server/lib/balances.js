function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function createDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(toDateString(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function toCutoffDate(date) {
  return new Date(`${date}T12:00:00.000Z`);
}

function flattenBalanceTransactions(transactions) {
  const flattened = [];
  for (const transaction of transactions ?? []) {
    if (transaction.is_parent) {
      for (const child of transaction.subtransactions ?? []) {
        if (!child.is_parent) flattened.push(child);
      }
    } else {
      flattened.push(transaction);
    }
  }
  return flattened;
}

function getLatestTransactionDate(transactionsByAccount) {
  let latestDate = null;
  for (const transactions of transactionsByAccount.values()) {
    for (const transaction of flattenBalanceTransactions(transactions)) {
      if (transaction.date && !transaction.tombstone && (!latestDate || transaction.date > latestDate)) {
        latestDate = transaction.date;
      }
    }
  }
  return latestDate;
}

function buildAccountRunningBalance(account, transactions, dates) {
  const flattened = flattenBalanceTransactions(transactions).filter(
    (transaction) => transaction.date && !transaction.tombstone
  );
  const startingTransactions = flattened.filter(
    (transaction) => transaction.starting_balance_flag
  );
  const startingBalance = startingTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.amount || 0),
    0
  );
  const startingBalanceDate = startingTransactions
    .map((transaction) => transaction.date)
    .sort()[0] ?? null;
  const dailyChanges = new Map();

  for (const transaction of flattened) {
    dailyChanges.set(
      transaction.date,
      (dailyChanges.get(transaction.date) ?? 0) + Number(transaction.amount || 0)
    );
  }

  const firstGraphDate = dates[0];
  let runningBalance = [...dailyChanges.entries()]
    .filter(([date]) => date < firstGraphDate)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const openingBalance = runningBalance;
  const series = dates.map((date) => {
    runningBalance += dailyChanges.get(date) ?? 0;
    return { date, balance: runningBalance };
  });
  const currentBalance = series.at(-1)?.balance ?? openingBalance;

  return {
    id: String(account.id),
    name: String(account.name || "Unnamed account"),
    offbudget: Boolean(account.offbudget),
    startingBalance,
    startingBalanceDate,
    currentBalance,
    openingBalance,
    periodChange: currentBalance - openingBalance,
    series,
  };
}

function buildRunningBalanceData(accounts, transactionsByAccount, startDate, endDate) {
  const dates = createDateRange(startDate, endDate);
  const accountSeries = accounts.map((account) =>
    buildAccountRunningBalance(account, transactionsByAccount.get(account.id), dates)
  );
  const mergedSeries = dates.map((date, index) => ({
    date,
    balance: accountSeries.reduce((sum, account) => sum + account.series[index].balance, 0),
  }));
  const mergedOpeningBalance = accountSeries.reduce(
    (sum, account) => sum + account.openingBalance,
    0
  );
  const mergedCurrentBalance = mergedSeries.at(-1)?.balance ?? mergedOpeningBalance;

  return {
    startDate,
    endDate,
    accounts: accountSeries,
    merged: {
      currentBalance: mergedCurrentBalance,
      openingBalance: mergedOpeningBalance,
      periodChange: mergedCurrentBalance - mergedOpeningBalance,
      series: mergedSeries,
    },
  };
}

function assertEndingBalances(balanceData, actualBalancesByAccount) {
  for (const account of balanceData.accounts) {
    const actualBalance = Number(actualBalancesByAccount.get(account.id) || 0);
    if (account.currentBalance !== actualBalance) {
      throw new Error(`Running balance validation failed for account ${account.id}`);
    }
  }
}

function getDateWindow(days, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: toDateString(start), endDate: toDateString(end) };
}

module.exports = {
  assertEndingBalances,
  buildAccountRunningBalance,
  buildRunningBalanceData,
  createDateRange,
  flattenBalanceTransactions,
  getDateWindow,
  getLatestTransactionDate,
  toCutoffDate,
};

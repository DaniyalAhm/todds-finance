const express = require("express");
const router = express.Router();
const actual = require("@actual-app/api");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const { initActual, shutdownActual } = require("../lib/actual");
const { flattenCategories } = require("../lib/rules");
const { getUniqueUncategorizedTransactions } = require("../lib/ai");
const {
  askOpenWebUiForCycleInsights,
  buildCycleSummary,
  validateCycleDays,
} = require("../lib/insights");
const {
  assertEndingBalances,
  buildRunningBalanceData,
  getDateWindow,
  getLatestTransactionDate,
  toCutoffDate,
} = require("../lib/balances");

function validateBankSyncRequest(body) {
  if (body?.accountIds === undefined) return { value: null };
  if (!Array.isArray(body.accountIds)) return { error: "accountIds must be an array" };
  const accountIds = body.accountIds.map((id) => typeof id === "string" ? id.trim() : "");
  if (accountIds.some((id) => !id)) return { error: "Every account ID must be a non-empty string" };
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length > 50) return { error: "At most 50 accounts can be synced at once" };
  return { value: uniqueIds.length > 0 ? uniqueIds : null };
}

router.get("/api/actual/accounts", async (req, res) => {
  try {
    await initActual();
    const accounts = await actual.getAccounts();
    res.json(accounts);
  } catch (err) {
    console.error("accounts error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
});

router.post("/api/actual/bank-sync", async (req, res) => {
  const validation = validateBankSyncRequest(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  try {
    await initActual();
    const accounts = (await actual.getAccounts()).filter((account) => !account.closed);
    const requestedIds = validation.value ?? accounts.map((account) => account.id);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const missingIds = requestedIds.filter((id) => !accountsById.has(id));
    if (missingIds.length > 0) {
      return res.status(400).json({ error: `Unknown or closed account IDs: ${missingIds.join(", ")}` });
    }

    const synced = [];
    const errors = [];
    for (const accountId of requestedIds) {
      const account = accountsById.get(accountId);
      try {
        await actual.runBankSync({ accountId });
        synced.push({ id: account.id, name: account.name });
      } catch (err) {
        errors.push({ id: account.id, name: account.name, error: err.message || "Bank sync failed" });
      }
    }
    if (synced.length > 0) await actual.sync();

    res.json({
      summary: `Synced ${synced.length} accounts with ${errors.length} errors`,
      synced,
      errors,
    });
  } catch (err) {
    console.error("bank sync error:", err);
    res.status(500).json({ error: err.message || "Failed to sync bank accounts" });
  } finally {
    await shutdownActual();
  }
});

router.get("/api/actual/running-balances", async (req, res) => {
  const requestedDays = Number.parseInt(req.query.days, 10);
  const days = Number.isFinite(requestedDays)
    ? Math.min(730, Math.max(7, requestedDays))
    : 180;
  const todayWindow = getDateWindow(days);

  try {
    await initActual();
    const accounts = (await actual.getAccounts()).filter((account) => !account.closed);
    const transactionsByAccount = new Map();
    const endingBalancesByAccount = new Map();

    for (const account of accounts) {
      transactionsByAccount.set(account.id, await actual.getTransactions(account.id));
    }

    const latestTransactionDate = getLatestTransactionDate(transactionsByAccount);
    const graphEndDate =
      latestTransactionDate && latestTransactionDate > todayWindow.endDate
        ? latestTransactionDate
        : todayWindow.endDate;
    const { startDate, endDate } = getDateWindow(days, toCutoffDate(graphEndDate));

    for (const account of accounts) {
      endingBalancesByAccount.set(
        account.id,
        await actual.getAccountBalance(account.id, toCutoffDate(endDate))
      );
    }

    const balanceData = buildRunningBalanceData(
      accounts,
      transactionsByAccount,
      startDate,
      endDate
    );
    assertEndingBalances(balanceData, endingBalancesByAccount);

    res.set("Cache-Control", "no-store");
    res.json({
      days,
      source: "starting-balance-roll-forward",
      ...balanceData,
    });
  } catch (err) {
    console.error("running balances error:", err);
    res.status(500).json({ error: err.message || "Failed to load running balances" });
  } finally {
    await shutdownActual();
  }
});

router.post("/api/actual/cycle-insights", async (req, res) => {
  const validation = validateCycleDays(req.body?.days);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const days = validation.value;
  let cycleSummary;

  try {
    await initActual();
    const accounts = (await actual.getAccounts()).filter((account) => !account.closed);
    const transactionsByAccount = new Map();
    for (const account of accounts) {
      transactionsByAccount.set(account.id, await actual.getTransactions(account.id));
    }

    const todayWindow = getDateWindow(days);
    const latestTransactionDate = getLatestTransactionDate(transactionsByAccount);
    const graphEndDate =
      latestTransactionDate && latestTransactionDate > todayWindow.endDate
        ? latestTransactionDate
        : todayWindow.endDate;
    const { startDate, endDate } = getDateWindow(days, toCutoffDate(graphEndDate));
    const [payees, categoryData] = await Promise.all([
      actual.getPayees(),
      actual.getCategories(),
    ]);

    cycleSummary = buildCycleSummary({
      accounts,
      transactionsByAccount,
      payees,
      categories: flattenCategories(categoryData),
      startDate,
      endDate,
    });
  } catch (err) {
    console.error("cycle insights Actual error:", err);
    return res.status(500).json({ error: err.message || "Failed to prepare cycle data" });
  } finally {
    await shutdownActual();
  }

  try {
    const insights = await askOpenWebUiForCycleInsights(cycleSummary);
    const result = {
      days,
      period: cycleSummary.period,
      transactionCount: cycleSummary.transactionCount,
      totals: cycleSummary.totals,
      insights,
    };
    const filePath = path.join(DATA_DIR, `cycle-insights-${days}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
    res.json(result);
  } catch (err) {
    console.error("cycle insights Open WebUI error:", err);
    res.status(502).json({ error: err.message || "Failed to analyze cycle with Open WebUI" });
  }
});

router.get("/api/actual/cycle-insights", async (req, res) => {
  const validation = validateCycleDays(req.query.days);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const filePath = path.join(DATA_DIR, `cycle-insights-${validation.value}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "No saved analysis found for this period" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read saved analysis" });
  }
});



router.get("/api/actual/uncategorized", async (req, res) => {
  try {
    await initActual();
    const transactions = await actual.getTransactions();
    const uncategorized = getUniqueUncategorizedTransactions(transactions);
    res.json(uncategorized);
  } catch (err) {
    console.error("uncategorized error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
});

router.get("/api/actual/category-names", async (req, res) => {
  try {
    await initActual();
    const categoryData = await actual.getCategories();
    const categories = flattenCategories(categoryData);
    res.json(categories.map((category) => category.name));
  } catch (err) {
    console.error("category names error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
});

router.get("/api/actual/categories", async (req, res) => {
  try {
    await initActual();
    const categoryData = await actual.getCategories();
    const categories = flattenCategories(categoryData);
    res.json(categories);
  } catch (err) {
    console.error("categories error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
});

module.exports = router;
module.exports.validateBankSyncRequest = validateBankSyncRequest;

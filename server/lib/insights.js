const configManager = require("../config-manager");

function flattenInsightTransactions(transactions) {
  const flattened = [];
  for (const transaction of transactions ?? []) {
    if (transaction.is_parent) {
      for (const child of transaction.subtransactions ?? []) {
        flattened.push({
          ...transaction,
          ...child,
          date: child.date ?? transaction.date,
          payee: child.payee ?? transaction.payee,
          imported_payee: child.imported_payee ?? transaction.imported_payee,
          transfer_id: child.transfer_id ?? transaction.transfer_id,
          is_parent: false,
        });
      }
    } else {
      flattened.push(transaction);
    }
  }
  return flattened;
}

function rankedEntries(map, limit = 8) {
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function buildCycleSummary({ accounts, transactionsByAccount, payees, categories, startDate, endDate }) {
  const payeesById = new Map(payees.map((payee) => [payee.id, payee.name]));
  const categoriesById = new Map(categories.map((category) => [category.id, category.name]));
  const spendingByCategory = new Map();
  const spendingByPayee = new Map();
  const monthly = new Map();
  const expenses = [];
  let income = 0;
  let spending = 0;
  let transactionCount = 0;

  for (const account of accounts) {
    for (const transaction of flattenInsightTransactions(transactionsByAccount.get(account.id))) {
      if (
        !transaction.date ||
        transaction.date < startDate ||
        transaction.date > endDate ||
        transaction.tombstone ||
        transaction.starting_balance_flag ||
        transaction.transfer_id
      ) {
        continue;
      }

      const amount = Number(transaction.amount || 0);
      transactionCount += 1;
      const month = transaction.date.slice(0, 7);
      if (!monthly.has(month)) monthly.set(month, { income: 0, spending: 0, net: 0 });
      const monthSummary = monthly.get(month);
      monthSummary.net += amount;

      if (amount >= 0) {
        income += amount;
        monthSummary.income += amount;
        continue;
      }

      const expenseAmount = Math.abs(amount);
      spending += expenseAmount;
      monthSummary.spending += expenseAmount;
      const categoryName = categoriesById.get(transaction.category) || "Uncategorized";
      const payeeName =
        payeesById.get(transaction.payee) ||
        transaction.imported_payee ||
        "Unknown payee";
      spendingByCategory.set(
        categoryName,
        (spendingByCategory.get(categoryName) ?? 0) + expenseAmount
      );
      spendingByPayee.set(payeeName, (spendingByPayee.get(payeeName) ?? 0) + expenseAmount);
      expenses.push({
        date: transaction.date,
        amount: expenseAmount,
        payee: payeeName,
        category: categoryName,
        account: account.name,
      });
    }
  }

  return {
    period: { startDate, endDate },
    units: "integer cents",
    transactionCount,
    accountCount: accounts.length,
    totals: { income, spending, net: income - spending },
    monthly: [...monthly.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, values]) => ({ month, ...values })),
    topSpendingCategories: rankedEntries(spendingByCategory),
    topSpendingPayees: rankedEntries(spendingByPayee),
    largestExpenses: expenses.sort((a, b) => b.amount - a.amount).slice(0, 10),
  };
}

function normalizeInsightList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item) => {
    if (typeof item === "string") return { title: item, detail: "" };
    return {
      title: String(item?.title || "Insight"),
      detail: String(item?.detail || item?.evidence || ""),
    };
  });
}

function parseInsightContent(content) {
  const cleaned = String(content ?? "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  return {
    summary: String(parsed.summary || "Cycle analysis complete."),
    glows: normalizeInsightList(parsed.glows),
    grows: normalizeInsightList(parsed.grows),
  };
}

async function askOpenWebUiForCycleInsights(cycleSummary) {
  const config = configManager.getConfig();
  if (!config.aiServerUrl) throw new Error("Open WebUI API URL is not configured");
  if (!config.aiApiKey) throw new Error("Open WebUI API key is not configured");
  if (!config.aiModel) throw new Error("Open WebUI model is not configured");

  const response = await fetch(config.aiServerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.aiModel,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You analyze a filtered Actual Budget cycle. Return only valid JSON with this shape: {"summary":"two-three sentences","glows":[{"title":"short strength","detail":"specific evidence"}],"grows":[{"title":"short opportunity","detail":"specific evidence"}]}. Provide 2-4 concise glows and 2-4 concise grows. Base every claim on the supplied figures. Amounts are integer cents. Do not use markdown or invent facts.`,
        },
        {
          role: "user",
          content: JSON.stringify(cycleSummary),
        },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Open WebUI request failed: ${response.status} ${raw.slice(0, 300)}`);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("Open WebUI returned a non-JSON response");
  }
  const content =
    envelope.choices?.[0]?.message?.content ??
    envelope.message?.content ??
    envelope.response ??
    envelope.content;
  if (!content) throw new Error("Open WebUI response did not contain insight content");

  try {
    return parseInsightContent(content);
  } catch (err) {
    throw new Error(`Open WebUI returned invalid insight JSON: ${err.message}`);
  }
}

function validateCycleDays(value) {
  const days = Number.parseInt(value, 10);
  if (![30, 90, 180, 365].includes(days)) {
    return { error: "days must be one of 30, 90, 180, or 365" };
  }
  return { value: days };
}

module.exports = {
  askOpenWebUiForCycleInsights,
  buildCycleSummary,
  flattenInsightTransactions,
  parseInsightContent,
  validateCycleDays,
};

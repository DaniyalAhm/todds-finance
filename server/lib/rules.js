const actual = require("@actual-app/api");

function normalizeString(value) {
  return String(value ?? "").trim().toLowerCase();
}

function flattenCategories(categoryData) {
  const categories = [];

  for (const group of categoryData ?? []) {
    if (Array.isArray(group.categories)) {
      for (const category of group.categories) {
        if (!category?.name) continue;
        categories.push({
          id: category.id,
          name: category.name,
          groupId: group.id ?? null,
          groupName: group.name ?? null,
          hidden: Boolean(category.hidden),
        });
      }
    } else if (group?.name) {
      categories.push({
        id: group.id,
        name: group.name,
        groupId: null,
        groupName: null,
        hidden: Boolean(group.hidden),
      });
    }
  }

  return categories;
}

function makeCategoryMaps(categories) {
  const byName = new Map();
  const byId = new Map();

  for (const category of categories) {
    if (category.id) byId.set(category.id, category);
    if (category.name) byName.set(normalizeString(category.name), category);
  }

  return { byName, byId };
}

function normalizeAiRule(rule, index, categoryMaps) {
  const categoryName = rule.categoryName ?? rule.category ?? rule.category_name ?? "";
  const categoryByName = categoryMaps.byName.get(normalizeString(categoryName));
  const categoryById = rule.categoryId ? categoryMaps.byId.get(rule.categoryId) : null;
  const category = categoryById ?? categoryByName ?? null;

  return {
    id: rule.id ?? `rule-${index + 1}`,
    selected: true,
    importedPayee:
      rule.importedPayee ??
      rule.imported_payee ??
      rule.matchText ??
      rule.payee ??
      null,
    matchText:
      rule.matchText ??
      rule.importedPayee ??
      rule.imported_payee ??
      rule.payee ??
      null,
    payeeName:
      rule.payeeName ??
      rule.payee_name ??
      rule.payee ??
      rule.importedPayee ??
      rule.imported_payee ??
      null,
    payeeId: rule.payeeId ?? rule.payee_id ?? null,
    categoryName: category?.name ?? categoryName ?? null,
    categoryId: category?.id ?? rule.categoryId ?? rule.category_id ?? null,
    confidence:
      typeof rule.confidence === "number"
        ? rule.confidence
        : Number(rule.confidence ?? 0.75),
    reason: rule.reason ?? null,
  };
}

async function findOrCreatePayee({ payees, payeeName, categoryId }) {
  const existing = payees.find(
    (payee) => normalizeString(payee.name) === normalizeString(payeeName)
  );

  if (existing?.id) return existing.id;

  if (typeof actual.createPayee !== "function") {
    throw new Error(
      `Payee "${payeeName}" does not exist, and this Actual API version does not expose createPayee(). Create the payee in Actual first or update @actual-app/api.`
    );
  }

  const created = await actual.createPayee({
    name: payeeName,
    category: categoryId || undefined,
  });

  const payeeId = typeof created === "string" ? created : created?.id;

  if (!payeeId) {
    throw new Error(
      `Could not create payee "${payeeName}". Actual returned: ${JSON.stringify(created)}`
    );
  }

  payees.push({
    id: payeeId,
    name: payeeName,
    category: categoryId || undefined,
  });

  return payeeId;
}

function buildActualRulePayload({ rule, payeeId, categoryId }) {
  const matchText = rule.matchText || rule.importedPayee;

  const conditions = [
    {
      field: "payee",
      op: "is",
      value: matchText,
    },
  ];

  const actions = [];

  if (categoryId) {
    actions.push({
      op: "set",
      field: "category",
      value: categoryId,
    });
  }

  return {
    stage: "pre",
    conditionsOp: "and",
    conditions,
    actions,
  };
}

function getTxField(tx, field, payeesById) {
  if (field === "payee") {
    return tx.payee_name || payeesById.get(tx.payee)?.name || tx.imported_payee || "";
  }
  if (field === "imported_payee") return tx.imported_payee || "";
  if (field === "notes") return tx.notes || "";
  if (field === "category") return tx.category || "";
  if (field === "account") return tx.account || "";
  if (field === "amount") return tx.amount;
  if (field === "date") return tx.date;
  if (field === "cleared") return tx.cleared;
  return tx[field];
}

function matchesCondition(tx, condition, payeesById) {
  const actualValue = getTxField(tx, condition.field, payeesById);
  const expected = condition.value;
  const op = condition.op;

  const a = normalizeString(actualValue);
  const b = normalizeString(expected);

  if (op === "is") return a === b;
  if (op === "isNot") return a !== b;
  if (op === "contains") return a.includes(b);
  if (op === "doesNotContain") return !a.includes(b);
  if (op === "startsWith") return a.startsWith(b);
  if (op === "endsWith") return a.endsWith(b);
  if (op === "matches") return new RegExp(expected, "i").test(String(actualValue ?? ""));
  if (op === "gt" || op === ">") return Number(actualValue) > Number(expected);
  if (op === "gte" || op === ">=") return Number(actualValue) >= Number(expected);
  if (op === "lt" || op === "<") return Number(actualValue) < Number(expected);
  if (op === "lte" || op === "<=") return Number(actualValue) <= Number(expected);

  console.warn(`Unsupported condition op: ${op}`);
  return false;
}

function ruleMatches(tx, rule, payeesById) {
  const conditions = rule.conditions || [];
  if (!conditions.length) return true;

  const results = conditions.map((c) => matchesCondition(tx, c, payeesById));

  return rule.conditionsOp === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}

function applyActionToTx(tx, updates, action, onlyUpdateBlankFields) {
  if (action.op !== "set" && action.op !== "prepend" && action.op !== "append") {
    console.warn(`Unsupported action op: ${action.op}`);
    return;
  }

  const field = action.field;
  const value = action.value;

  if (onlyUpdateBlankFields) {
    const current = tx[field];
    const alreadySet =
      current !== null &&
      current !== undefined &&
      current !== "" &&
      current !== false;

    if (alreadySet && field !== "notes") return;
  }

  if (action.op === "set") updates[field] = value;
  if (field === "notes" && action.op === "prepend") {
    updates.notes = `${value}${tx.notes || ""}`;
  }
  if (field === "notes" && action.op === "append") {
    updates.notes = `${tx.notes || ""}${value}`;
  }
}

function sortRulesByStage(rules) {
  const order = { pre: 0, default: 1, post: 2 };
  return [...rules].sort((a, b) => (order[a.stage] ?? 1) - (order[b.stage] ?? 1));
}

module.exports = {
  flattenCategories,
  makeCategoryMaps,
  normalizeAiRule,
  findOrCreatePayee,
  buildActualRulePayload,
  getTxField,
  matchesCondition,
  ruleMatches,
  applyActionToTx,
  sortRulesByStage,
};

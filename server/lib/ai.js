const configManager = require("../config-manager");

function requireConfig(name, value) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
}

function cleanAiJson(content) {
  return String(content ?? "").replace(/```json/g, "").replace(/```/g, "").trim();
}

function extractJsonArray(content) {
  const cleaned = cleanAiJson(content);

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {}

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const possibleObject = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return [JSON.parse(possibleObject)];
    } catch {}
  }

  console.error("Bad AI content:", cleaned);
  return [];
}

function getUniqueUncategorizedTransactions(transactions) {
  return [
    ...new Map(
      transactions
        .filter((transaction) => transaction.category == null)
        .map((transaction) => {
          const item = {
            id: transaction.id ?? null,
            date: transaction.date ?? null,
            amount: transaction.amount ?? null,
            imported_payee: transaction.imported_payee ?? null,
            payee: transaction.payee ?? null,
            payee_name: transaction.payee_name ?? null,
            notes: transaction.notes ?? null,
            category: transaction.category ?? null,
            category_name: transaction.category_name ?? null,
          };
          const key = `${item.imported_payee ?? ""}|${item.payee_name ?? ""}|${item.notes ?? ""}`;
          return [key, item];
        })
        .filter(([key, item]) => item.imported_payee || item.payee_name || item.notes)
    ).values(),
  ];
}

async function askAiToSuggestRules({ categories, uncategorized, prompt, allowSearch }) {
  const config = configManager.getConfig();

  requireConfig("AI_SERVER_URL", config.aiServerUrl);
  requireConfig("AI_API_KEY", config.aiApiKey);

  const categoryPayload = categories.map((category) => ({
    id: category.id,
    name: category.name,
    groupName: category.groupName,
  }));

  const userPrompt =
    prompt ||
    "Look at these uncategorized Actual transactions and suggest conservative payee/category rules.";

  const aiResponse = await fetch(config.aiServerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.aiModel,
      stream: false,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `
You are a JSON API for Actual Budget rule suggestions.

Return ONLY valid JSON.
No markdown.
No explanation.
No headings.
No code fences.

You are given uncategorized transactions and existing Actual categories.

CRITICAL PAYEE RULE:
Do NOT invent, shorten, rename, simplify, or normalize payee names.
The "payeeName" field must be copied exactly from the transaction's imported_payee field.
If imported_payee is empty, copy exactly from payee_name.
If both are empty, copy exactly from notes.
Never use a generic name like "Car Wash", "Restaurant", "Gas", "Store", or "Insurance" unless that exact text appears in the transaction.

CRITICAL MATCH RULE:
The "matchText" field must also be copied exactly from imported_payee when available.
Do not create new match text.

CATEGORY RULE:
Use ONLY the provided category names and category IDs.
Do not create new categories.

Return a JSON array of objects, one suggestion per unique transaction in the batch.
The response must start with [ and end with ].
If there are multiple transactions with the same payee, return one rule for that payee (deduplicate by payee).
If you are uncertain about a transaction, omit it from the array.

Use this exact shape for each object:
{
  "matchText": "exact imported_payee text",
  "payeeName": "exact imported_payee text",
  "categoryName": "existing category name",
  "categoryId": "existing category id",
  "confidence": 0.9
}
`,
        },
        {
          role: "user",
          content: `
User instructions:
${userPrompt}

Existing Actual categories:
${JSON.stringify(categoryPayload, null, 2)}

Uncategorized transactions:
${JSON.stringify(uncategorized, null, 2)}
`,
        },
      ],
    }),
  });

  const rawText = await aiResponse.text();

  console.log("AI status:", aiResponse.status);
  console.log("AI raw response:", rawText);

  if (!aiResponse.ok) {
    throw new Error(`AI request failed: ${aiResponse.status} ${rawText}`);
  }

  let aiData;

  try {
    aiData = JSON.parse(rawText);
  } catch {
    throw new Error(`AI server did not return JSON: ${rawText.slice(0, 500)}`);
  }

  const content =
    aiData.choices?.[0]?.message?.content ??
    aiData.message?.content ??
    aiData.response ??
    aiData.content;

  if (!content) {
    throw new Error(`AI response had no content: ${JSON.stringify(aiData).slice(0, 500)}`);
  }

  return extractJsonArray(content);
}

module.exports = { askAiToSuggestRules, getUniqueUncategorizedTransactions };

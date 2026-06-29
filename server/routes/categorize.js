const express = require("express");
const router = express.Router();
const actual = require("@actual-app/api");
const { initActual, shutdownActual } = require("../lib/actual");
const { askAiToSuggestRules, getUniqueUncategorizedTransactions } = require("../lib/ai");
const { flattenCategories, makeCategoryMaps, normalizeAiRule } = require("../lib/rules");

const jobs = new Map();
let jobCounter = 0;

function generateJobId() {
  return `job-${Date.now()}-${++jobCounter}`;
}

function chunkArray(items, size = 5) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

router.post("/api/categorize", async (req, res) => {
  console.log("POST /api/categorize hit");

  const jobId = generateJobId();
  const chunkSize = Math.max(1, Math.min(50, Number(req.body.chunkSize) || 5));
  const prompt = req.body.prompt;
  const allowSearch = Boolean(req.body.allowSearch);

  const job = {
    id: jobId,
    status: "pending",
    totalChunks: 0,
    completedChunks: 0,
    rules: [],
    transactions: [],
    errors: [],
    summary: null,
    createdAt: new Date(),
  };

  jobs.set(jobId, job);
  res.json({ jobId });

  processJob(job, { chunkSize, prompt, allowSearch }).catch((err) => {
    console.error(`Job ${jobId} fatal error:`, err);
    job.status = "error";
    job.errors.push({ chunk: -1, error: err.message || "Fatal job error" });
  });
});

async function processJob(job, { chunkSize, prompt, allowSearch }) {
  job.status = "processing";

  try {
    await initActual();

    const transactions = await actual.getTransactions();
    const categoryData = await actual.getCategories();

    const categories = flattenCategories(categoryData);
    const categoryMaps = makeCategoryMaps(categories);

    const uncategorized = getUniqueUncategorizedTransactions(transactions);
    const chunks = chunkArray(uncategorized, chunkSize);

    job.totalChunks = chunks.length;
    job.transactions = uncategorized;

    console.log("Category count:", categories.length);
    console.log("Uncategorized total:", uncategorized.length);
    console.log("AI query count:", chunks.length);
    console.log("Chunk size:", chunkSize);
    console.log("Allow search:", allowSearch);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      console.log(
        `Job ${job.id}: AI categorize chunk ${i + 1}/${chunks.length}, size ${chunk.length}`
      );

      try {
        const aiRules = await askAiToSuggestRules({
          categories,
          uncategorized: chunk,
          prompt:
            prompt ||
            `Categorize this small batch of transactions and suggest Actual payee rules. Use only the existing categories. Return only a JSON array. No markdown. Batch ${i + 1} of ${chunks.length}.`,
          allowSearch,
        });

        const normalized = aiRules.map((rule, index) =>
          normalizeAiRule(rule, job.rules.length + index, categoryMaps)
        );

        job.rules.push(...normalized);
      } catch (err) {
        console.error(`Job ${job.id}: AI chunk ${i + 1} failed:`, err);
        job.errors.push({
          chunk: i + 1,
          error: err.message || "Unknown AI chunk error",
          transactions: chunk,
        });
      }

      job.completedChunks = i + 1;
    }

    job.summary = `Found ${uncategorized.length} uncategorized transaction patterns, sent ${chunks.length} AI queries, and suggested ${job.rules.length} rules.`;
    job.status = "done";
  } catch (err) {
    console.error(`Job ${job.id} error:`, err);
    job.status = "error";
    job.errors.push({ chunk: -1, error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
}

router.get("/api/categorize/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    jobId: job.id,
    status: job.status,
    totalChunks: job.totalChunks,
    completedChunks: job.completedChunks,
    rules: job.rules,
    transactions: job.transactions,
    errors: job.errors,
    summary: job.summary,
  });
});

module.exports = router;

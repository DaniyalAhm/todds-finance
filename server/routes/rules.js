const express = require("express");
const router = express.Router();
const actual = require("@actual-app/api");
const { initActual, shutdownActual } = require("../lib/actual");
const {
  flattenCategories,
  makeCategoryMaps,
  normalizeAiRule,
  findOrCreatePayee,
  buildActualRulePayload,
  sortRulesByStage,
  ruleMatches,
  applyActionToTx,
} = require("../lib/rules");

const applyJobs = new Map();
let applyJobCounter = 0;

router.post("/api/actual/payee-rules", async (req, res) => {
  try {
    await initActual();

    const { rules } = req.body;

    if (!Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ error: "No rules provided" });
    }

    const payees = await actual.getPayees();
    const categoryData = await actual.getCategories();
    const categories = flattenCategories(categoryData);
    const categoryMaps = makeCategoryMaps(categories);

    const createdRules = [];
    const errors = [];

    for (const rule of rules) {
      try {
        const normalized = normalizeAiRule(rule, 0, categoryMaps);

        const payeeId = await findOrCreatePayee({
          payees,
          payeeName: normalized.payeeName,
          categoryId: normalized.categoryId,
        });

        const categoryId = normalized.categoryId || null;

        const rulePayload = buildActualRulePayload({
          rule: normalized,
          payeeId,
          categoryId,
        });

        const createdRule = await actual.createRule(rulePayload);

        createdRules.push({
          rule: normalized,
          payeeId,
          categoryId,
          actualRuleId: createdRule?.id ?? createdRule ?? null,
        });
      } catch (err) {
        errors.push({
          rule,
          error: err.message || "Unknown error creating rule",
        });
      }
    }

    res.json({
      summary: `Created ${createdRules.length} payee rules, ${errors.length} errors`,
      created: createdRules,
      errors,
    });
  } catch (err) {
    console.error("payee-rules POST error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
});

router.post("/api/actual/apply-rules", async (req, res) => {
  const jobId = `apply-${Date.now()}-${++applyJobCounter}`;
  const startDate = req.body.startDate || "2000-01-01";
  const endDate = req.body.endDate || "2026-12-31";
  const dryRun = req.body.dryRun !== false;
  const onlyUpdateBlankFields = req.body.onlyUpdateBlankFields !== false;

  const job = {
    id: jobId,
    status: "pending",
    scanned: 0,
    changed: 0,
    errors: [],
    summary: null,
    startDate,
    endDate,
    dryRun,
    onlyUpdateBlankFields,
    createdAt: new Date(),
  };

  applyJobs.set(jobId, job);
  res.json({ jobId });

  processApplyJob(job).catch((err) => {
    console.error(`Apply job ${jobId} fatal error:`, err);
    job.status = "error";
    job.errors.push({ error: err.message || "Fatal job error" });
  });
});

async function processApplyJob(job) {
  job.status = "processing";

  try {
    await initActual();

    const accounts = await actual.getAccounts();
    const payees = await actual.getPayees();
    const rules = sortRulesByStage(await actual.getRules());

    const payeesById = new Map(payees.map((p) => [p.id, p]));

    console.log(
      `Apply job ${job.id}: ${accounts.length} accounts, ${payees.length} payees, ${rules.length} rules`
    );

    for (const account of accounts) {
      if (account.closed) continue;

      const transactions = await actual.getTransactions(
        account.id,
        job.startDate,
        job.endDate
      );

      for (const tx of transactions) {
        job.scanned++;

        const updates = {};

        for (const rule of rules) {
          if (!ruleMatches(tx, rule, payeesById)) continue;

          for (const action of rule.actions || []) {
            applyActionToTx(tx, updates, action, job.onlyUpdateBlankFields);
          }

          Object.assign(tx, updates);
        }

        if (!Object.keys(updates).length) continue;

        job.changed++;

        if (!job.dryRun) {
          try {
            await actual.updateTransaction(tx.id, updates);
          } catch (err) {
            job.errors.push({
              transactionId: tx.id,
              date: tx.date,
              payee: tx.payee_name || tx.imported_payee,
              error: err.message || "Update failed",
            });
          }
        }
      }
    }

    const mode = job.dryRun ? "Would update" : "Updated";
    job.summary = `Scanned ${job.scanned} transactions across ${accounts.length} accounts using ${rules.length} rules. ${mode} ${job.changed} transactions with ${job.errors.length} errors.`;
    job.status = "done";
  } catch (err) {
    console.error(`Apply job ${job.id} error:`, err);
    job.status = "error";
    job.errors.push({ error: err.message || "Unknown error" });
  } finally {
    await shutdownActual();
  }
}

router.get("/api/actual/apply-rules/progress/:jobId", (req, res) => {
  const job = applyJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Apply job not found" });
  }

  res.json({
    jobId: job.id,
    status: job.status,
    scanned: job.scanned,
    changed: job.changed,
    errors: job.errors,
    summary: job.summary,
    startDate: job.startDate,
    endDate: job.endDate,
    dryRun: job.dryRun,
    onlyUpdateBlankFields: job.onlyUpdateBlankFields,
  });
});

module.exports = router;

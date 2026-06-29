const express = require("express");
const actual = require("@actual-app/api");
const { initActual, shutdownActual } = require("../lib/actual");
const { getPayeeClustersFromFlask } = require("../services/flask.service");

const router = express.Router();

function toPublicPayee(payee) {
  const transferAccountId = payee.transfer_acct ?? payee.transferAccountId ?? null;
  return {
    id: String(payee.id),
    name: String(payee.name || "Unnamed payee"),
    transferAccountId,
    isTransfer: Boolean(transferAccountId),
  };
}

function validateMergeRequest(body) {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return { error: "Merge must be a JSON object" };
  }

  const targetPayeeId = typeof body.targetPayeeId === "string" ? body.targetPayeeId.trim() : "";
  if (!targetPayeeId) return { error: "targetPayeeId is required" };
  if (!Array.isArray(body.sourcePayeeIds)) return { error: "sourcePayeeIds must be an array" };

  const sourcePayeeIds = body.sourcePayeeIds.map((id) =>
    typeof id === "string" ? id.trim() : ""
  );
  if (sourcePayeeIds.some((id) => !id)) {
    return { error: "Every source payee ID must be a non-empty string" };
  }

  const uniqueSourceIds = [...new Set(sourcePayeeIds)];
  if (uniqueSourceIds.length === 0) return { error: "Select at least one source payee" };
  if (uniqueSourceIds.length > 100) return { error: "A merge can contain at most 100 source payees" };
  if (uniqueSourceIds.includes(targetPayeeId)) {
    return { error: "The target payee cannot also be a source payee" };
  }

  return { value: { targetPayeeId, sourcePayeeIds: uniqueSourceIds } };
}

function validateMergeBatchRequest(body) {
  const rawMerges = Array.isArray(body?.merges) ? body.merges : [body];
  if (rawMerges.length === 0) return { error: "Select at least one merge suggestion" };
  if (rawMerges.length > 50) return { error: "At most 50 merge suggestions can be pushed at once" };

  const merges = [];
  const usedPayeeIds = new Set();
  for (let index = 0; index < rawMerges.length; index += 1) {
    const validation = validateMergeRequest(rawMerges[index]);
    if (validation.error) return { error: `Merge ${index + 1}: ${validation.error}` };

    const ids = [validation.value.targetPayeeId, ...validation.value.sourcePayeeIds];
    const repeatedId = ids.find((id) => usedPayeeIds.has(id));
    if (repeatedId) {
      return { error: `Payee ${repeatedId} appears in more than one merge suggestion` };
    }
    ids.forEach((id) => usedPayeeIds.add(id));
    merges.push(validation.value);
  }

  return { value: merges };
}

function buildMergeSuggestions(flaskData, payees) {
  const payeesById = new Map(
    payees.filter((payee) => !payee.isTransfer).map((payee) => [payee.id, payee])
  );
  const clusters = new Map();

  for (const row of flaskData?.clusters ?? []) {
    const payeeId = String(row.unique_id ?? row.payee_id ?? row.id ?? "");
    const clusterId = String(row.cluster_id ?? row.clusterId ?? "");
    const payee = payeesById.get(payeeId);
    if (!payee || !clusterId) continue;
    if (!clusters.has(clusterId)) clusters.set(clusterId, new Map());
    clusters.get(clusterId).set(payee.id, payee);
  }

  return [...clusters.entries()]
    .map(([clusterId, memberMap]) => {
      const members = [...memberMap.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      const suggestedTarget = [...members].sort(
        (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)
      )[0];
      return {
        id: `cluster-${clusterId}`,
        clusterId,
        suggestedTargetId: suggestedTarget?.id ?? null,
        members,
      };
    })
    .filter((suggestion) => suggestion.members.length > 1)
    .sort((a, b) => a.members[0].name.localeCompare(b.members[0].name));
}

async function loadPublicPayees() {
  await initActual();
  try {
    return (await actual.getPayees())
      .map(toPublicPayee)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } finally {
    await shutdownActual();
  }
}

router.get("/api/actual/payees", async (req, res) => {
  try {
    const payees = await loadPublicPayees();
    res.set("Cache-Control", "no-store");
    res.json({ payees });
  } catch (err) {
    console.error("payees GET error:", err);
    res.status(500).json({ error: err.message || "Failed to load payees" });
  }
});

router.get("/api/actual/payee-merge-suggestions", async (req, res) => {
  let payees;
  try {
    payees = await loadPublicPayees();
  } catch (err) {
    console.error("merge suggestions Actual error:", err);
    return res.status(500).json({ error: err.message || "Failed to load payees from Actual" });
  }

  try {
    const eligiblePayees = payees.filter((payee) => !payee.isTransfer);
    const flaskData = await getPayeeClustersFromFlask(eligiblePayees);
    const suggestions = buildMergeSuggestions(flaskData, eligiblePayees);
    res.set("Cache-Control", "no-store");
    res.json({
      suggestions,
      totalPayees: eligiblePayees.length,
      suggestedGroups: suggestions.length,
      suggestedPayees: suggestions.reduce((count, group) => count + group.members.length, 0),
    });
  } catch (err) {
    console.error("merge suggestions Flask error:", err);
    res.status(502).json({ error: err.message || "Failed to get suggestions from Flask" });
  }
});

router.post("/api/actual/merge-payees", async (req, res) => {
  const validation = validateMergeBatchRequest(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  try {
    await initActual();
    const payees = (await actual.getPayees()).map(toPublicPayee);
    const payeesById = new Map(payees.map((payee) => [payee.id, payee]));

    for (const merge of validation.value) {
      const requestedIds = [merge.targetPayeeId, ...merge.sourcePayeeIds];
      const missingIds = requestedIds.filter((id) => !payeesById.has(id));
      if (missingIds.length > 0) {
        return res.status(400).json({ error: `Unknown payee IDs: ${missingIds.join(", ")}` });
      }
      const transferPayees = requestedIds
        .map((id) => payeesById.get(id))
        .filter((payee) => payee.isTransfer);
      if (transferPayees.length > 0) {
        return res.status(400).json({
          error: `Transfer payees cannot be merged: ${transferPayees.map((payee) => payee.name).join(", ")}`,
        });
      }
    }

    const merged = [];
    const errors = [];
    for (const merge of validation.value) {
      const target = payeesById.get(merge.targetPayeeId);
      const sources = merge.sourcePayeeIds.map((id) => payeesById.get(id));
      try {
        await actual.mergePayees(merge.targetPayeeId, merge.sourcePayeeIds);
        merged.push({ target, sources });
      } catch (err) {
        errors.push({
          target,
          sources,
          error: err.message || "Actual merge failed",
        });
      }
    }

    res.json({
      summary: `Merged ${merged.length} payee groups with ${errors.length} errors`,
      merged,
      errors,
    });
  } catch (err) {
    console.error("merge-payees POST error:", err);
    res.status(500).json({ error: err.message || "Failed to merge payees" });
  } finally {
    await shutdownActual();
  }
});

module.exports = router;
module.exports.toPublicPayee = toPublicPayee;
module.exports.validateMergeRequest = validateMergeRequest;
module.exports.validateMergeBatchRequest = validateMergeBatchRequest;
module.exports.buildMergeSuggestions = buildMergeSuggestions;

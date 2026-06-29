const express = require("express");
const cors = require("cors");
const actual = require("@actual-app/api");
const path = require("path");
const fs = require("fs/promises");

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
}));

app.use(express.json());

const PORT = Number(process.env.PORT ?? 3010);
const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL;
const ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD;
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID;

function isFileHasResetError(err) {
  return err?.reason === "file-has-reset" || String(err?.message ?? "").includes("file-has-reset");
}

async function clearMatchingBudgetCache(dataDir) {
  let entries = [];
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const budgetDir = path.join(dataDir, entry.name);
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(budgetDir, "metadata.json"), "utf8"));
      if (
        metadata.groupId === ACTUAL_SYNC_ID ||
        metadata.cloudFileId === ACTUAL_SYNC_ID ||
        metadata.id === ACTUAL_SYNC_ID
      ) {
        console.warn(`Removing stale Actual cache: ${budgetDir}`);
        await fs.rm(budgetDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

app.get("/api/actual/categories", async (req, res) => {
  if (!ACTUAL_SERVER_URL || !ACTUAL_PASSWORD || !ACTUAL_SYNC_ID) {
    return res.status(500).json({ error: "Server not configured. Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID env vars." });
  }

  try {
    const dataDir = path.join(process.cwd(), "cache");
    await fs.mkdir(dataDir, { recursive: true });

    await actual.init({
      dataDir,
      serverURL: ACTUAL_SERVER_URL,
      password: ACTUAL_PASSWORD,
    });

    try {
      await actual.downloadBudget(ACTUAL_SYNC_ID);
    } catch (err) {
      if (!isFileHasResetError(err)) throw err;

      console.warn("Budget was reset on server, clearing local cache and retrying...");
      try {
        await actual.shutdown();
      } catch {}

      await clearMatchingBudgetCache(dataDir);

      await actual.init({
        dataDir,
        serverURL: ACTUAL_SERVER_URL,
        password: ACTUAL_PASSWORD,
      });
      await actual.downloadBudget(ACTUAL_SYNC_ID);
    }

    const categoryData = await actual.getCategories();

    res.json(categoryData);
  } catch (err) {
    console.error(err);

    try {
      await actual.shutdown();
    } catch {}

    res.status(500).json({
      error: err.message || "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Actual API server running on http://localhost:${PORT}`);
});
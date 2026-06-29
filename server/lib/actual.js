const actual = require("@actual-app/api");
const path = require("path");
const fs = require("fs/promises");
const configManager = require("../config-manager");

let actualClientStarted = false;
let actualBudgetLoaded = false;
let actualLock = Promise.resolve();
let releaseActualLock = null;

async function acquireActualLock() {
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const previousLock = actualLock;
  actualLock = previousLock.then(() => nextLock);
  await previousLock;
  releaseActualLock = release;
}

function isFileHasResetError(err) {
  return err?.reason === "file-has-reset" || String(err?.message ?? "").includes("file-has-reset");
}

async function safeShutdownActual() {
  if (!actualClientStarted) return;
  try {
    await actual.shutdown();
  } catch (err) {
    console.warn("Actual shutdown warning:", err?.message ?? err);
  } finally {
    actualClientStarted = false;
    actualBudgetLoaded = false;
  }
}

async function findCachedBudgetDirs(dataDir) {
  const { actualSyncId } = configManager.getConfig();
  const matches = new Set();

  try {
    const budgets = await actual.getBudgets();
    for (const budget of budgets) {
      if (
        budget.groupId === actualSyncId ||
        budget.cloudFileId === actualSyncId ||
        budget.id === actualSyncId
      ) {
        matches.add(path.join(dataDir, budget.id));
      }
    }
  } catch (err) {
    console.warn("Could not inspect local Actual budgets before cache reset:", err?.message ?? err);
  }

  let entries = [];
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return [...matches];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budgetDir = path.join(dataDir, entry.name);
    const metadataPath = path.join(budgetDir, "metadata.json");
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (
        metadata.groupId === actualSyncId ||
        metadata.cloudFileId === actualSyncId ||
        metadata.id === actualSyncId
      ) {
        matches.add(budgetDir);
      }
    } catch {}
  }

  return [...matches];
}

async function clearBudgetCache(dataDir) {
  const budgetDirs = await findCachedBudgetDirs(dataDir);
  await safeShutdownActual();

  if (budgetDirs.length) {
    for (const budgetDir of budgetDirs) {
      console.warn(`Removing stale Actual cache: ${budgetDir}`);
      await fs.rm(budgetDir, { recursive: true, force: true }).catch(() => {});
    }
  } else {
    console.warn(`No matching Actual cache folder found; clearing full cache dir: ${dataDir}`);
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }

  await fs.mkdir(dataDir, { recursive: true });
}

function requireConfig(name, value) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
}

async function initActual() {
  await acquireActualLock();
  actualClientStarted = false;
  actualBudgetLoaded = false;

  try {
    const config = configManager.getConfig();

    requireConfig("ACTUAL_SERVER_URL", config.actualServerUrl);
    requireConfig("ACTUAL_PASSWORD", config.actualPassword);
    requireConfig("ACTUAL_SYNC_ID", config.actualSyncId);

    const dataDir = path.join(process.cwd(), "cache");
    await fs.mkdir(dataDir, { recursive: true });

    await actual.init({
      dataDir,
      serverURL: config.actualServerUrl,
      password: config.actualPassword,
    });
    actualClientStarted = true;

    try {
      await actual.downloadBudget(config.actualSyncId);
      actualBudgetLoaded = true;
    } catch (err) {
      if (!isFileHasResetError(err)) throw err;

      console.warn("Budget was reset on server, clearing local cache and retrying...");
      await clearBudgetCache(dataDir);

      await actual.init({
        dataDir,
        serverURL: config.actualServerUrl,
        password: config.actualPassword,
      });
      actualClientStarted = true;

      try {
        await actual.downloadBudget(config.actualSyncId);
        actualBudgetLoaded = true;
      } catch (retryErr) {
        console.error("Retry after file-has-reset also failed:", retryErr?.message ?? retryErr);
        throw new Error(`Budget download failed after cache reset: ${retryErr?.message || "unknown"}`);
      }
    }
  } catch (err) {
    await safeShutdownActual();
    if (releaseActualLock) {
      releaseActualLock();
      releaseActualLock = null;
    }
    throw err;
  }
}

async function shutdownActual() {
  try {
    await safeShutdownActual();
  } finally {
    if (releaseActualLock) {
      releaseActualLock();
      releaseActualLock = null;
    }
  }
}

module.exports = { initActual, shutdownActual };

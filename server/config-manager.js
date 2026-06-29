const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "config.json");

const CONFIG_FIELDS = [
  "actualServerUrl",
  "actualPassword",
  "actualSyncId",
  "aiServerUrl",
  "aiApiKey",
  "aiModel",
];

const DEFAULT_CONFIG = {
  actualServerUrl: process.env.ACTUAL_SERVER_URL || "",
  actualPassword: process.env.ACTUAL_PASSWORD || "",
  actualSyncId: process.env.ACTUAL_SYNC_ID || "",
  aiServerUrl: process.env.AI_SERVER_URL || "",
  aiApiKey: process.env.AI_API_KEY || "",
  aiModel: process.env.AI_MODEL || "gemma4:e4b",
};

let cachedConfig = null;

function saveConfigSync(config) {
  const directory = path.dirname(CONFIG_PATH);
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, CONFIG_PATH);
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch (err) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {}
    throw new Error(`Could not save configuration: ${err.message}`, { cause: err });
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const config = { ...DEFAULT_CONFIG };
    saveConfigSync(config);
    cachedConfig = config;
    return cachedConfig;
  }

  let storedConfig;
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
    storedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    throw new Error(`Could not read configuration: ${err.message}`, { cause: err });
  }

  if (!storedConfig || Array.isArray(storedConfig) || typeof storedConfig !== "object") {
    throw new Error("Could not read configuration: expected a JSON object");
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  for (const field of CONFIG_FIELDS) {
    if (typeof storedConfig[field] === "string") cachedConfig[field] = storedConfig[field];
  }
  return cachedConfig;
}

function getConfig() {
  return cachedConfig || loadConfig();
}

function updateConfig(partial) {
  const nextConfig = { ...getConfig() };
  for (const field of CONFIG_FIELDS) {
    if (partial[field] !== undefined) nextConfig[field] = partial[field];
  }
  saveConfigSync(nextConfig);
  cachedConfig = nextConfig;
  return { ...cachedConfig };
}

function getPublicConfig() {
  const config = getConfig();
  return {
    actualServerUrl: config.actualServerUrl,
    actualSyncId: config.actualSyncId,
    aiServerUrl: config.aiServerUrl,
    aiModel: config.aiModel,
    aiApiKeyConfigured: Boolean(config.aiApiKey),
    actualPasswordConfigured: Boolean(config.actualPassword),
  };
}

module.exports = { CONFIG_FIELDS, getConfig, updateConfig, getPublicConfig, loadConfig };

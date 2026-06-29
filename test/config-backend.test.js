const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "actual-ai-config-"));
const configPath = path.join(testDirectory, "config.json");
process.env.CONFIG_PATH = configPath;

const configManager = require("../server/config-manager");
const { validateConfigUpdate } = require("../server/routes/config");

test.after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));

test("configuration is persisted without exposing secrets", () => {
  configManager.updateConfig({
    actualServerUrl: "https://budget.example.test",
    actualPassword: "actual-secret",
    actualSyncId: "sync-id",
    aiServerUrl: "http://localhost:11434/v1/chat/completions",
    aiApiKey: "ai-secret",
    aiModel: "gemma3:12b",
  });

  const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(stored.aiApiKey, "ai-secret");
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(configManager.getPublicConfig(), {
    actualServerUrl: "https://budget.example.test",
    actualSyncId: "sync-id",
    aiServerUrl: "http://localhost:11434/v1/chat/completions",
    aiModel: "gemma3:12b",
    aiApiKeyConfigured: true,
    actualPasswordConfigured: true,
  });
});

test("valid updates are normalized and blank secrets are preserved", () => {
  assert.deepEqual(
    validateConfigUpdate({
      aiServerUrl: "  http://localhost:11434/v1/chat/completions  ",
      aiModel: "  llama3.2  ",
      aiApiKey: "",
    }),
    {
      update: {
        aiServerUrl: "http://localhost:11434/v1/chat/completions",
        aiModel: "llama3.2",
      },
    }
  );
});

test("invalid configuration updates return useful validation errors", () => {
  assert.match(validateConfigUpdate(null).error, /JSON object/);
  assert.match(validateConfigUpdate({ aiModel: 123 }).error, /must be a string/);
  assert.match(validateConfigUpdate({ aiServerUrl: "not a url" }).error, /valid URL/);
  assert.match(validateConfigUpdate({ actualServerUrl: "file:///tmp/budget" }).error, /http or https/);
  assert.match(validateConfigUpdate({ unknown: "value" }).error, /No valid fields/);
});

test("a malformed config file is reported and is not overwritten", () => {
  fs.writeFileSync(configPath, "{broken", "utf8");
  assert.throws(() => configManager.loadConfig(), /Could not read configuration/);
  assert.equal(fs.readFileSync(configPath, "utf8"), "{broken");
});

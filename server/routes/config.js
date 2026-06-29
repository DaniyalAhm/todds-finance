const express = require("express");
const configManager = require("../config-manager");

const router = express.Router();

const FIELD_LIMITS = {
  actualServerUrl: 2048,
  actualPassword: 8192,
  actualSyncId: 256,
  aiServerUrl: 2048,
  aiApiKey: 8192,
  aiModel: 256,
};
const URL_FIELDS = new Set(["actualServerUrl", "aiServerUrl"]);
const SECRET_FIELDS = new Set(["actualPassword", "aiApiKey"]);

function validateConfigUpdate(body) {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const update = {};
  for (const field of configManager.CONFIG_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") return { error: `${field} must be a string` };

    const value = SECRET_FIELDS.has(field) ? body[field] : body[field].trim();
    if (value.length > FIELD_LIMITS[field]) {
      return { error: `${field} must be ${FIELD_LIMITS[field]} characters or fewer` };
    }

    // Empty secret inputs mean "keep the current value" in both configuration UIs.
    if (SECRET_FIELDS.has(field) && value === "") continue;

    if (URL_FIELDS.has(field) && value !== "") {
      let parsedUrl;
      try {
        parsedUrl = new URL(value);
      } catch {
        return { error: `${field} must be a valid URL` };
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { error: `${field} must use http or https` };
      }
    }
    update[field] = value;
  }

  if (Object.keys(update).length === 0) return { error: "No valid fields to update" };
  return { update };
}

router.get("/api/config", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(configManager.getPublicConfig());
  } catch (err) {
    console.error("config read error:", err);
    res.status(500).json({ error: err.message || "Failed to get configuration" });
  }
});

router.put("/api/config", (req, res) => {
  const validation = validateConfigUpdate(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  try {
    configManager.updateConfig(validation.update);
    res.json({ message: "Configuration updated", config: configManager.getPublicConfig() });
  } catch (err) {
    console.error("config update error:", err);
    res.status(500).json({ error: err.message || "Failed to update configuration" });
  }
});

module.exports = router;
module.exports.validateConfigUpdate = validateConfigUpdate;

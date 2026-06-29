const express = require("express");
const cors = require("cors");

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (not crashing):", err?.message ?? err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (not crashing):", err?.message ?? err);
});

const app = express();
const PORT = Number(process.env.PORT ?? 3010);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "actual-ai-server", port: PORT });
});

app.use(require("./routes/config"));
app.use(require("./routes/actual"));
app.use(require("./routes/categorize"));
app.use(require("./routes/rules"));
app.use(require("./routes/payees"));

app.listen(PORT, () => {
  console.log(`Actual AI server running on http://localhost:${PORT}`);
});

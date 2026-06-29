const FLASK_API_BASE = process.env.FLASK_API_BASE || "http://127.0.0.1:5000";
const FLASK_TIMEOUT_MS = Number(process.env.FLASK_TIMEOUT_MS || 120000);

async function getPayeeClustersFromFlask(payees) {
  const endpoint = `${FLASK_API_BASE.replace(/\/$/, "")}/payees`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payees }),
      signal: AbortSignal.timeout(FLASK_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`Flask request timed out after ${FLASK_TIMEOUT_MS}ms`);
    }
    throw new Error(`Could not reach Flask API at ${endpoint}: ${err.message}`, { cause: err });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Flask API returned a non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`Flask request failed: ${response.status} ${data.error || response.statusText}`);
  }
  if (!data || !Array.isArray(data.clusters)) {
    throw new Error("Flask response must include a clusters array");
  }

  return data;
}

module.exports = {
  getPayeeClustersFromFlask,
  sendPayeesToFlask: getPayeeClustersFromFlask,
};

# AI Budgeting

AI-powered personal finance management tool that integrates with [Actual Budget](https://actualbudget.org).

## Architecture

- **`server/`** — Express.js backend. Connects to Actual Budget API to read accounts/transactions/payees/categories, runs bank sync, computes running balances and cycle insights, and uses an AI service (Open WebUI compatible) to auto-categorize transactions and generate rules.
- **`actual-ai/`** — Next.js 16 frontend (React 19, Tailwind CSS 4). Dashboards for balances and insights, UI for auto-categorization, payee merging, and configuration.
- **`ml-python/`** — Python/Flask microservice using Splink for fuzzy payee name deduplication, consumed by the server to suggest payee merges.

## Getting Started

### Server (Express)

```bash
cd server
npm install
node index.js
```

Runs on `http://localhost:3010`.

### Frontend (Next.js)

```bash
cd actual-ai
npm install
npm run dev
```

Runs on `http://localhost:3000`.

### ML Service (Python)

```bash
cd ml-python
pip install -r requirements.txt
python entity-resolution.py
```

Runs on `http://localhost:5000`.

## Configuration

Configure via the UI at `/configuration` or by setting environment variables on the server:

| Variable | Description |
|---|---|
| `ACTUAL_SERVER_URL` | Actual Budget server URL |
| `ACTUAL_PASSWORD` | Actual Budget password |
| `ACTUAL_SYNC_ID` | Actual Budget sync ID |
| `AI_SERVER_URL` | Open WebUI compatible AI API URL |
| `AI_API_KEY` | AI API key |
| `AI_MODEL` | AI model name (default: `gemma4:e4b`) |
| `FRONTEND_ORIGIN` | CORS origin (default: `http://localhost:3000`) |
| `FLASK_API_BASE` | Flask service URL (default: `http://127.0.0.1:5000`) |

## Commands

```bash
npm run dev     # Start server with --watch
npm start       # Start server
npm test        # Run tests
```


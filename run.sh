#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FLASK_PID=""
SERVER_PID=""
NEXT_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$NEXT_PID" ] && kill "$NEXT_PID" 2>/dev/null && echo "Stopped Next.js"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null && echo "Stopped server"
  [ -n "$FLASK_PID" ] && kill "$FLASK_PID" 2>/dev/null && echo "Stopped Flask"
  wait 2>/dev/null
  echo "All services stopped"
}
trap cleanup SIGINT SIGTERM EXIT

export FLASK_API_BASE="${FLASK_API_BASE:-http://127.0.0.1:5000}"

echo "Starting Flask (ML service)..."
cd "$ROOT/ml-python"
python entity-resolution.py &
FLASK_PID=$!

sleep 1

echo "Starting Express server..."
cd "$ROOT/server"
node index.js &
SERVER_PID=$!

echo "Starting Next.js frontend..."
cd "$ROOT/actual-ai"
npm run dev &
NEXT_PID=$!

echo ""
echo "All services running:"
echo "  Flask    http://localhost:5000"
echo "  Server   http://localhost:3010"
echo "  Frontend http://localhost:3000"
echo "Press Ctrl+C to stop all"

wait

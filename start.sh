#!/usr/bin/env bash
# Dhan Drishti — one-command local launcher (macOS / Linux).
# Builds the web app, starts the single-service server (API + UI on one port),
# and opens your browser once it's ready. Re-run any time; your data persists in ./data.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4000}"
URL="http://localhost:${PORT}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found. Install Node.js + pnpm first: https://pnpm.io/installation" >&2
  exit 1
fi

echo "Dhan Drishti — starting…"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run, this can take a minute)…"
  pnpm install
fi

echo "Building the web app…"
pnpm --filter @dhan-drishti/web build

# Open the browser once the server answers /health (background; server runs in foreground below).
(
  for _ in $(seq 1 60); do
    if curl -fs "${URL}/health" >/dev/null 2>&1; then
      case "$(uname -s)" in
        Darwin) open "${URL}" ;;
        *) xdg-open "${URL}" >/dev/null 2>&1 || true ;;
      esac
      break
    fi
    sleep 1
  done
) &

echo "Starting Dhan Drishti on ${URL} — press Ctrl+C to stop."
PORT="${PORT}" exec pnpm --filter @dhan-drishti/server serve

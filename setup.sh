#!/usr/bin/env bash
# Dhan Drishti — first-time setup for a fresh Mac.
# Installs Homebrew, Node.js and pnpm (whatever is missing), then installs
# project dependencies. Safe to re-run. Afterwards, launch with ./start.sh.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS. Install Node.js >= 20 and pnpm manually." >&2
  exit 1
fi

echo "Dhan Drishti — setup"

# 1. Homebrew (also pulls in Xcode Command Line Tools)
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$b" ]] && eval "$("$b" shellenv)" && break
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew (you may be asked for your password)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$b" ]] && eval "$("$b" shellenv)" && break
  done
  # Persist brew on PATH for future terminals
  if ! grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null; then
    echo "eval \"\$($(command -v brew) shellenv)\"" >> "$HOME/.zprofile"
  fi
fi
echo "✓ Homebrew $(brew --version | head -1 | awk '{print $2}')"

# 2. Node.js >= 20
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if ! command -v node >/dev/null 2>&1 || (( $(node_major) < 20 )); then
  echo "Installing Node.js…"
  brew install node
fi
echo "✓ Node.js $(node -v)"

# 3. pnpm (pinned version from package.json via Corepack)
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Enabling pnpm…"
  corepack enable 2>/dev/null || brew install pnpm
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
echo "✓ pnpm $(pnpm -v)"

# 4. Project dependencies
echo "Installing project dependencies…"
pnpm install

# 5. Optional env file for the News page
if [[ ! -f apps/server/.env && -f apps/server/.env.example ]]; then
  cp apps/server/.env.example apps/server/.env
  echo "Created apps/server/.env (add your Azure OpenAI key for News — optional)."
fi

chmod +x start.sh
echo
echo "Setup complete. Run:  ./start.sh"

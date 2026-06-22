#!/usr/bin/env bash
# scripts/e2e.sh — run Playwright under a real Node binary.
#
# Why: on dev machines that install Bun and put ~/.bun/bin first on PATH, the
# `node` command is a Bun shim. Bun's native TS transpiler rejects spec files
# that Playwright's own Babel-based TS loader (used under real Node) accepts
# fine — surfacing as `AggregateError: N errors building "<spec>.ts"` with
# empty `BuildMessage {}` objects and zero tests discovered. Running the
# Playwright CLI under a real Node lets Playwright register its Babel ESM
# loader and build every spec. On CI / normal machines `node` is already real
# Node, so this just delegates to it.
#
# Usage: sh scripts/e2e.sh [playwright args...]   (defaults to `test`)
set -euo pipefail

# Locate the Playwright CLI shipped with @playwright/test (resolves the symlink
# that Bun's node_modules layout creates).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PW_CLI="$SCRIPT_DIR/../node_modules/@playwright/test/cli.js"
if [ ! -f "$PW_CLI" ]; then
  echo "e2e.sh: @playwright/test CLI not found at $PW_CLI" >&2
  exit 127
fi

# Pick a real Node: the first candidate whose `--version` prints `v<semver>`.
# (Bun's `node` shim prints a bare number like `1.3.14`, not `v26.x`.)
real_node=""
for candidate in "${NODE_REAL:-}" "$(command -v volta 2>/dev/null && volta which node 2>/dev/null)" \
                 /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  if "$candidate" --version 2>/dev/null | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    real_node="$candidate"
    break
  fi
done

if [ -z "$real_node" ]; then
  echo "e2e.sh: no real Node binary found (Bun's 'node' shim cannot run Playwright's TS specs)." >&2
  echo "e2e.sh: install Node (e.g. \`brew install node\`) or set NODE_REAL=/path/to/node." >&2
  exit 127
fi

# Default subcommand is `test`.
if [ "$#" -eq 0 ]; then
  set -- test
fi

exec "$real_node" "$PW_CLI" "$@"
#!/bin/sh
# Run the Angular CLI (`ng`) under a real Node runtime.
#
# Why: Angular 22 CLI requires Node >= v22.22.3 / v24.15.0 / v26.0.0. Bun's
# runtime reports as Node v24.3.0 (below the v24.15.0 minimum), so any `ng`
# command run via Bun fails the version gate with:
#   "The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0"
# `which -a node | tail -1` picks the system/real Node — Bun prepends its `node`
# shim to PATH, so the real Node is later on PATH and gets selected. On machines
# without Bun's shim this simply resolves the (only) real Node.
#
# Usage from package.json scripts: "build": "sh scripts/ng.sh build", etc.
# See also scripts/serve.sh (same real-Node pattern, specifically for `ng serve`).
exec "$(which -a node | tail -1)" node_modules/.bin/ng "$@"
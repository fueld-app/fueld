#!/bin/sh
# Serve the Angular dev server under a real Node runtime.
#
# Why: Bun (and Bun's `node` shim, which shadows system `node` on PATH)
# implements `net.Socket` WITHOUT `destroySoon`. Vite's dev-server proxy calls
# `socket.destroySoon()` on proxied-response end, so under Bun the proxy throws
# `TypeError: socket.destroySoon is not a function` and the dev server exits —
# which takes down every e2e test after it (ERR_CONNECTION_REFUSED on :4200).
# Real Node's `net.Socket` has `destroySoon`, so the proxy works there.
#
# `which -a node | tail -1` picks the last `node` on PATH. Bun prepends its shim,
# so the system/real Node is later in PATH and gets selected. On machines
# without Bun's shim this simply resolves the (only) real Node.
exec "$(which -a node | tail -1)" node_modules/.bin/ng serve "$@"
#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  LLM Server — Start llama-server with Qwen 3.5 0.6B
#
#  Usage:  ./scripts/llm/start.sh [--port 8081]
#
#  Tuned for small VPS (1–2 CPU, 2 GB RAM):
#    - 2048 context window (prevents OOM)
#    - 1 parallel slot
#    - 2 threads
#    - Flash attention enabled
#
#  Exposes an OpenAI-compatible API on the configured port.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_BIN="$SCRIPT_DIR/bin/llama-server"
MODEL_PATH="$SCRIPT_DIR/models/Qwen3.5-0.8B-Q4_K_M.gguf"

# Configurable via env vars or flags
LLM_PORT="${LLM_PORT:-8081}"
LLM_HOST="${LLM_HOST:-127.0.0.1}"
LLM_CTX="${LLM_CTX:-2048}"
LLM_THREADS="${LLM_THREADS:-2}"
LLM_PARALLEL="${LLM_PARALLEL:-1}"

# Parse --port flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  LLM_PORT="$2"; shift 2 ;;
    --ctx)   LLM_CTX="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

# Auto-setup if binary or model is missing
if [[ ! -f "$LLAMA_BIN" ]] || [[ ! -f "$MODEL_PATH" ]]; then
  echo "⚙  llama-server or model not found — running setup automatically..."
  bash "$SCRIPT_DIR/setup.sh"
fi

echo "═══════════════════════════════════════════════════════"
echo "  Starting llama-server"
echo "  Model:     $(basename "$MODEL_PATH")"
echo "  Endpoint:  http://${LLM_HOST}:${LLM_PORT}"
echo "  Context:   ${LLM_CTX} tokens"
echo "  Threads:   ${LLM_THREADS}"
echo "  Parallel:  ${LLM_PARALLEL} slot(s)"
echo "═══════════════════════════════════════════════════════"
echo ""

# Ensure shared libraries are found next to the binary
BIN_DIR="$(dirname "$LLAMA_BIN")"
export DYLD_LIBRARY_PATH="$BIN_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$BIN_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec "$LLAMA_BIN" \
  --model "$MODEL_PATH" \
  --host "$LLM_HOST" \
  --port "$LLM_PORT" \
  --ctx-size "$LLM_CTX" \
  --threads "$LLM_THREADS" \
  --parallel "$LLM_PARALLEL" \
  --flash-attn auto \
  --cont-batching \
  --log-disable

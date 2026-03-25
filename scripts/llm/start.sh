#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  LLM Server — Start llama-server with runtime/profile-aware tuning
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
DEFAULT_PROFILE="cpu"
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  DEFAULT_PROFILE="apple-silicon-experimental"
fi

LLM_RUNTIME="${LLM_RUNTIME:-mainline}"
LLM_PROFILE="${LLM_PROFILE:-$DEFAULT_PROFILE}"
LLM_PORT="${LLM_PORT:-8081}"
LLM_HOST="${LLM_HOST:-127.0.0.1}"
CPU_COUNT="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
LLM_CTX="${LLM_CTX:-4096}"
LLM_THREADS="${LLM_THREADS:-$CPU_COUNT}"
LLM_THREADS_BATCH="${LLM_THREADS_BATCH:-$LLM_THREADS}"
LLM_PARALLEL="${LLM_PARALLEL:-1}"
LLM_BATCH="${LLM_BATCH:-1024}"
LLM_UBATCH="${LLM_UBATCH:-256}"
LLM_FLASH_ATTN="${LLM_FLASH_ATTN:-on}"
LLM_CACHE_TYPE_K="${LLM_CACHE_TYPE_K:-q8_0}"
LLM_CACHE_TYPE_V="${LLM_CACHE_TYPE_V:-q8_0}"
LLM_GPU_LAYERS="${LLM_GPU_LAYERS:-0}"

case "$LLM_PROFILE" in
  cuda)
    LLM_BATCH="${LLM_BATCH:-2048}"
    LLM_UBATCH="${LLM_UBATCH:-512}"
    LLM_THREADS_BATCH="${LLM_THREADS_BATCH:-2}"
    LLM_GPU_LAYERS="${LLM_GPU_LAYERS:-999}"
    ;;
  apple-silicon-experimental)
    LLM_UBATCH="${LLM_UBATCH:-512}"
    ;;
esac

# Parse --port flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  LLM_PORT="$2"; shift 2 ;;
    --ctx)   LLM_CTX="$2"; shift 2 ;;
    --runtime) LLM_RUNTIME="$2"; shift 2 ;;
    --profile) LLM_PROFILE="$2"; shift 2 ;;
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
echo "  Runtime:   ${LLM_RUNTIME}"
echo "  Profile:   ${LLM_PROFILE}"
echo "  Model:     $(basename "$MODEL_PATH")"
echo "  Endpoint:  http://${LLM_HOST}:${LLM_PORT}"
echo "  Context:   ${LLM_CTX} tokens"
echo "  Threads:   ${LLM_THREADS}"
echo "  T.Batch:   ${LLM_THREADS_BATCH}"
echo "  Parallel:  ${LLM_PARALLEL} slot(s)"
echo "  Batch:     ${LLM_BATCH} / ${LLM_UBATCH}"
echo "═══════════════════════════════════════════════════════"
echo ""

# Ensure shared libraries are found next to the binary
BIN_DIR="$(dirname "$LLAMA_BIN")"
export DYLD_LIBRARY_PATH="$BIN_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$BIN_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

ARGS=(
  --model "$MODEL_PATH"
  --host "$LLM_HOST"
  --port "$LLM_PORT"
  --ctx-size "$LLM_CTX"
  --threads "$LLM_THREADS"
  --threads-batch "$LLM_THREADS_BATCH"
  --parallel "$LLM_PARALLEL"
  --batch-size "$LLM_BATCH"
  --ubatch-size "$LLM_UBATCH"
  --flash-attn "$LLM_FLASH_ATTN"
  --cache-type-k "$LLM_CACHE_TYPE_K"
  --cache-type-v "$LLM_CACHE_TYPE_V"
  --cont-batching
  --log-disable
)

if [[ "$LLM_PROFILE" == "cuda" && "$LLM_GPU_LAYERS" != "0" ]]; then
  ARGS+=( --gpu-layers "$LLM_GPU_LAYERS" )
fi

exec "$LLAMA_BIN" "${ARGS[@]}"

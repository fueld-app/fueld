#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  LLM Setup — Download llama-server binary + Qwen 3.5 0.6B GGUF model
#
#  Usage:  ./scripts/llm/setup.sh
#
#  Downloads into scripts/llm/bin/ and scripts/llm/models/
#  These directories are .gitignored.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${LLM_BIN_DIR:-$SCRIPT_DIR/bin}"
MODEL_DIR="${LLM_MODEL_DIR:-$SCRIPT_DIR/models}"

mkdir -p "$BIN_DIR" "$MODEL_DIR"

# ── Detect platform ──────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64" ;;
  *)             echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

# ── Download llama-server ────────────────────────────────────────────

LLAMA_CPP_VERSION="${LLAMA_CPP_VERSION:-b8201}"
LLAMA_BIN="$BIN_DIR/llama-server"

if [[ -f "$LLAMA_BIN" ]]; then
  echo "✓ llama-server already exists at $LLAMA_BIN"
else
  echo "⬇  Downloading llama.cpp $LLAMA_CPP_VERSION for $PLATFORM-$ARCH_TAG ..."

  if [[ "$PLATFORM" == "macos" ]]; then
    ASSET_NAME="llama-${LLAMA_CPP_VERSION}-bin-macos-${ARCH_TAG}.tar.gz"
  else
    ASSET_NAME="llama-${LLAMA_CPP_VERSION}-bin-ubuntu-${ARCH_TAG}.tar.gz"
  fi

  DOWNLOAD_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${ASSET_NAME}"
  TMP_ARCHIVE="$(mktemp)"

  echo "   URL: $DOWNLOAD_URL"
  curl -fSL --progress-bar -o "$TMP_ARCHIVE" "$DOWNLOAD_URL"

  TMP_EXTRACT="$(mktemp -d)"
  tar -xzf "$TMP_ARCHIVE" -C "$TMP_EXTRACT"
  rm -f "$TMP_ARCHIVE"

  # The binary is in bin/ inside the archive
  FOUND_BIN="$(find "$TMP_EXTRACT" -name 'llama-server' -type f | head -1)"
  if [[ -z "$FOUND_BIN" ]]; then
    echo "❌ llama-server not found in archive. Contents:"
    find "$TMP_EXTRACT" -type f | head -20
    rm -rf "$TMP_EXTRACT"
    exit 1
  fi

  BIN_SOURCE_DIR="$(dirname "$FOUND_BIN")"

  cp "$FOUND_BIN" "$LLAMA_BIN"
  chmod +x "$LLAMA_BIN"

  # Copy companion shared libraries (libmtmd, libllama, libggml, etc.)
  for lib in "$BIN_SOURCE_DIR"/*.{dylib,so,dll} "$BIN_SOURCE_DIR"/../lib/*.{dylib,so,dll}; do
    [[ -f "$lib" ]] && cp "$lib" "$BIN_DIR/" && echo "  → copied $(basename "$lib")"
  done

  rm -rf "$TMP_EXTRACT"
  echo "✓ llama-server installed at $LLAMA_BIN"
fi

# ── Download Qwen 3.5 0.6B GGUF model ───────────────────────────────
#
#  Using Q4_K_M quantisation — good balance of quality vs size (~600MB).
#  Small enough for a 2 GB RAM VPS.
#  Skipped when SKIP_MODEL_DOWNLOAD=1 (model managed via admin UI).

if [[ "${SKIP_MODEL_DOWNLOAD:-}" == "1" ]]; then
  echo "⏭  Skipping model download (SKIP_MODEL_DOWNLOAD=1)"
else

MODEL_FILENAME="Qwen3.5-0.8B-Q4_K_M.gguf"
MODEL_PATH="$MODEL_DIR/$MODEL_FILENAME"

if [[ -f "$MODEL_PATH" ]]; then
  echo "✓ Model already exists at $MODEL_PATH"
else
  MODEL_URL="https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/${MODEL_FILENAME}"

  echo "⬇  Downloading $MODEL_FILENAME ..."
  echo "   URL: $MODEL_URL"
  curl -fSL --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
  echo "✓ Model downloaded to $MODEL_PATH"
fi

fi  # end SKIP_MODEL_DOWNLOAD

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Setup complete!"
echo "  Binary:  $LLAMA_BIN"
echo ""
echo "  Start with:  ./scripts/llm/start.sh"
echo "═══════════════════════════════════════════════════════"

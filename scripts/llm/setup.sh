#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  LLM Setup — Install llama-server from mainline llama.cpp or ik_llama.cpp
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
RUNTIME_CONFIG_PATH="$SCRIPT_DIR/runtime-config.json"

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

# ── Runtime selection ───────────────────────────────────────────────

DEFAULT_PROFILE="cpu"
if [[ "$PLATFORM" == "macos" && "$ARCH_TAG" == "arm64" ]]; then
  DEFAULT_PROFILE="apple-silicon-experimental"
fi

LLM_RUNTIME="${LLM_RUNTIME:-mainline}"
LLM_PROFILE="${LLM_PROFILE:-$DEFAULT_PROFILE}"
LLM_BUILD_FROM_SOURCE="${LLM_BUILD_FROM_SOURCE:-}"

case "$LLM_RUNTIME" in
  mainline) LLM_RUNTIME_VERSION="${LLM_RUNTIME_VERSION:-${LLAMA_CPP_VERSION:-b8201}}" ;;
  ik)       LLM_RUNTIME_VERSION="${LLM_RUNTIME_VERSION:-main}" ;;
  *)        echo "❌ Unsupported LLM_RUNTIME: $LLM_RUNTIME"; exit 1 ;;
esac

if [[ -z "$LLM_BUILD_FROM_SOURCE" ]]; then
  if [[ "$LLM_RUNTIME" == "ik" ]]; then
    LLM_BUILD_FROM_SOURCE="1"
  else
    LLM_BUILD_FROM_SOURCE="0"
  fi
fi

write_runtime_config() {
  cat > "$RUNTIME_CONFIG_PATH" <<EOF
{
  "runtime": "$LLM_RUNTIME",
  "profile": "$LLM_PROFILE",
  "version": "$LLM_RUNTIME_VERSION",
  "buildFromSource": $( [[ "$LLM_BUILD_FROM_SOURCE" == "1" ]] && echo true || echo false )
}
EOF
}

build_from_source() {
  local tmp_build repo_url version source_dir build_dir jobs
  tmp_build="$(mktemp -d)"
  repo_url="https://github.com/ggml-org/llama.cpp.git"
  if [[ "$LLM_RUNTIME" == "ik" ]]; then
    repo_url="https://github.com/ikawrakow/ik_llama.cpp.git"
  fi

  echo "⬇  Cloning $LLM_RUNTIME at ref $LLM_RUNTIME_VERSION ..."
  git clone --depth 1 --branch "$LLM_RUNTIME_VERSION" "$repo_url" "$tmp_build/llama.cpp"

  source_dir="$tmp_build/llama.cpp"
  build_dir="$source_dir/build"
  jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

  CMAKE_FLAGS=(
    -DCMAKE_BUILD_TYPE=Release
    -DLLAMA_BUILD_SERVER=ON
    -DGGML_NATIVE=ON
  )

  if [[ "$LLM_RUNTIME" == "ik" ]]; then
    CMAKE_FLAGS+=( -DGGML_IQK_FA_ALL_QUANTS=ON )
  fi
  if [[ "$LLM_PROFILE" == "cuda" ]]; then
    CMAKE_FLAGS+=( -DGGML_CUDA=ON )
    if [[ -n "${CMAKE_CUDA_ARCHITECTURES:-}" ]]; then
      CMAKE_FLAGS+=( "-DCMAKE_CUDA_ARCHITECTURES=${CMAKE_CUDA_ARCHITECTURES}" )
    fi
  else
    CMAKE_FLAGS+=( -DGGML_CUDA=OFF )
  fi
  if [[ "$LLM_PROFILE" == "apple-silicon-experimental" ]]; then
    CMAKE_FLAGS+=( -DGGML_METAL=ON )
  elif [[ "$PLATFORM" == "macos" ]]; then
    CMAKE_FLAGS+=( -DGGML_METAL=OFF )
  fi

  echo "⚙  Configuring build ..."
  cmake -B "$build_dir" "${CMAKE_FLAGS[@]}" "$source_dir"
  echo "⚙  Building llama-server ($jobs jobs) ..."
  cmake --build "$build_dir" --config Release -j "$jobs"

  local found_bin
  found_bin="$(find "$build_dir" -name 'llama-server' -type f | head -1)"
  if [[ -z "$found_bin" ]]; then
    echo "❌ llama-server not found after build"
    rm -rf "$tmp_build"
    exit 1
  fi

  cp "$found_bin" "$BIN_DIR/llama-server"
  chmod +x "$BIN_DIR/llama-server"

  while IFS= read -r lib; do
    [[ -n "$lib" ]] || continue
    cp "$lib" "$BIN_DIR/"
    echo "  → copied $(basename "$lib")"
  done < <(find "$build_dir" \( -name '*.dylib' -o -name '*.so' -o -name '*.so.*' \) \( -type f -o -type l \))

  if [[ "$LLM_RUNTIME" == "ik" ]]; then
    echo "$LLM_RUNTIME_VERSION" > "$BIN_DIR/.ik-llama-version"
  else
    echo "$LLM_RUNTIME_VERSION" > "$BIN_DIR/.llama-cpp-version"
  fi

  rm -rf "$tmp_build"
  echo "✓ Built llama-server for runtime=$LLM_RUNTIME profile=$LLM_PROFILE"
}

# ── Download llama-server ────────────────────────────────────────────

LLAMA_BIN="$BIN_DIR/llama-server"

if [[ -f "$LLAMA_BIN" ]]; then
  echo "✓ llama-server already exists at $LLAMA_BIN"
else
  if [[ "$LLM_RUNTIME" == "mainline" && "$LLM_BUILD_FROM_SOURCE" != "1" ]]; then
    echo "⬇  Downloading llama.cpp $LLM_RUNTIME_VERSION for $PLATFORM-$ARCH_TAG ..."

    if [[ "$PLATFORM" == "macos" ]]; then
      ASSET_NAME="llama-${LLM_RUNTIME_VERSION}-bin-macos-${ARCH_TAG}.tar.gz"
    else
      ASSET_NAME="llama-${LLM_RUNTIME_VERSION}-bin-ubuntu-${ARCH_TAG}.tar.gz"
    fi

    DOWNLOAD_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLM_RUNTIME_VERSION}/${ASSET_NAME}"
    TMP_ARCHIVE="$(mktemp)"

    echo "   URL: $DOWNLOAD_URL"
    curl -fSL --progress-bar -o "$TMP_ARCHIVE" "$DOWNLOAD_URL"

    TMP_EXTRACT="$(mktemp -d)"
    tar -xzf "$TMP_ARCHIVE" -C "$TMP_EXTRACT"
    rm -f "$TMP_ARCHIVE"

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

    for lib in "$BIN_SOURCE_DIR"/*.{dylib,so,dll} "$BIN_SOURCE_DIR"/../lib/*.{dylib,so,dll}; do
      [[ -f "$lib" ]] && cp "$lib" "$BIN_DIR/" && echo "  → copied $(basename "$lib")"
    done

    echo "$LLM_RUNTIME_VERSION" > "$BIN_DIR/.llama-cpp-version"
    rm -rf "$TMP_EXTRACT"
    echo "✓ llama-server installed at $LLAMA_BIN"
  else
    build_from_source
  fi
fi

write_runtime_config

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
echo "  Runtime: $LLM_RUNTIME"
echo "  Profile: $LLM_PROFILE"
echo "  Binary:  $LLAMA_BIN"
echo ""
echo "  Start with:  ./scripts/llm/start.sh"
echo "═══════════════════════════════════════════════════════"

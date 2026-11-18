#!/usr/bin/env bash
# Builds the Wasm planner into web/src/wasm/ (planner.js, planner.wasm, planner.d.ts).
#   ./cpp/build.sh                  runs em++ inside the emscripten/emsdk:4.0.10 Docker image
#   USE_LOCAL_EMCC=1 ./cpp/build.sh uses an em++ already on PATH (used by CI inside the emsdk container)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="web/src/wasm"
mkdir -p "$ROOT/$OUT"

ARGS=(
  cpp/planner.cpp cpp/bindings.cpp
  -std=c++17 -O3 --bind
  -sEXPORT_ES6=1 -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1
  -sMODULARIZE=1 -sEXPORT_NAME=createPlannerModule
  --emit-tsd planner.d.ts
  -o "$OUT/planner.js"
)

cd "$ROOT"
if [[ "${USE_LOCAL_EMCC:-0}" == "1" ]]; then
  em++ "${ARGS[@]}"
else
  docker run --rm --platform linux/amd64 -v "$ROOT":/src -w /src emscripten/emsdk:4.0.10 em++ "${ARGS[@]}"
fi

ls -l "$OUT"/planner.js "$OUT"/planner.wasm "$OUT"/planner.d.ts

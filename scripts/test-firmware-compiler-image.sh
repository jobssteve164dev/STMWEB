#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:-}"
[[ -n "$IMAGE" ]] || { echo "compiler image is required" >&2; exit 2; }

REPOSITORY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$REPOSITORY_ROOT/input/DOT-V1.0/标准版源代码/V1.0"
[[ -d "$SOURCE_ROOT" ]] || { echo "canonical DOT source is missing" >&2; exit 1; }

docker image inspect "$IMAGE" >/dev/null

CONTAINER_ID=""
cleanup_container() {
  if [[ -n "$CONTAINER_ID" ]]; then
    docker container rm --force "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup_container EXIT

CONTAINER_ID=$(docker create --platform linux/amd64 --entrypoint sh "$IMAGE" -c '
  set -eu
  for target in stm32f103cb stm32f103c8; do
    output="/tmp/stmweb-firmware-smoke-$target"
    cmake -S /opt/stmweb/adapters/dot-v1 -B "$output" -G Ninja \
      -DSTMWEB_TARGET="$target" \
      -DSTMWEB_SOURCE_ROOT=/source/smoke-source
    cmake --build "$output" --parallel 1
    node /source/verify-dot-initial-firmware.mjs "$output" "$target"
  done
')
docker cp "$SOURCE_ROOT/." "$CONTAINER_ID:/source/smoke-source"
docker cp "$REPOSITORY_ROOT/scripts/verify-dot-initial-firmware.mjs" "$CONTAINER_ID:/source/verify-dot-initial-firmware.mjs"
docker start --attach "$CONTAINER_ID"
docker container rm "$CONTAINER_ID" >/dev/null
CONTAINER_ID=""

printf 'firmware_compiler_real_build=ok\nfirmware_compiler_image=%s\n' "$IMAGE"

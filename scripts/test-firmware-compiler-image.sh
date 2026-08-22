#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:-}"
[[ -n "$IMAGE" ]] || { echo "compiler image is required" >&2; exit 2; }

REPOSITORY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$REPOSITORY_ROOT/input/DOT-V1.0/标准版源代码/V1.0"
[[ -d "$SOURCE_ROOT" ]] || { echo "canonical DOT source is missing" >&2; exit 1; }

docker image inspect "$IMAGE" >/dev/null

for target in stm32f103cb stm32f103c8; do
  docker run --rm --platform linux/amd64 \
    -e "STMWEB_SMOKE_TARGET=$target" \
    -v "$SOURCE_ROOT:/workspace/source:ro" \
    -v "$REPOSITORY_ROOT/scripts/verify-dot-initial-firmware.mjs:/workspace/verify-dot-initial-firmware.mjs:ro" \
    --entrypoint sh "$IMAGE" -c '
      set -eu
      output="/tmp/stmweb-firmware-smoke-$STMWEB_SMOKE_TARGET"
      cmake -S /opt/stmweb/adapters/dot-v1 -B "$output" -G Ninja \
        -DSTMWEB_TARGET="$STMWEB_SMOKE_TARGET" \
        -DSTMWEB_SOURCE_ROOT=/workspace/source
      cmake --build "$output" --parallel 1
      node /workspace/verify-dot-initial-firmware.mjs "$output" "$STMWEB_SMOKE_TARGET"
    '
done

printf 'firmware_compiler_real_build=ok\nfirmware_compiler_image=%s\n' "$IMAGE"

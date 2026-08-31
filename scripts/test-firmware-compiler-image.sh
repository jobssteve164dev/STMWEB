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
  for mode in bluetooth wired; do
    output="/tmp/stmweb-composition-$mode"
    composition="/source/dot-composition-$mode.json"
    cmake -S /opt/stmweb/adapters/dot-v1 -B "$output" -G Ninja \
      -DSTMWEB_TARGET=stm32f103c8 \
      -DSTMWEB_SOURCE_ROOT=/source/smoke-source \
      -DSTMWEB_COMPOSITION_FILE="$composition"
    cmake --build "$output" --parallel 1
    node -e "const fs=require(\"fs\");const a=JSON.parse(fs.readFileSync(\"$composition\"));const m=JSON.parse(fs.readFileSync(\"$output/stmweb_firmware_manifest.json\"));if(JSON.stringify(a)!==JSON.stringify(m.composition)||JSON.stringify(a.runtimeTransports)!==JSON.stringify(m.runtime.transports))process.exit(1)"
    if [ "$mode" = bluetooth ]; then
      arm-none-eabi-nm "$output/dot_v1.elf" | grep -q legacy_communication
    else
      if arm-none-eabi-nm "$output/dot_v1.elf" | grep -q legacy_communication; then
        echo "wired-only firmware still contains the bluetooth update bridge" >&2
        exit 1
      fi
    fi
  done
  export IDF_PATH=/opt/esp/idf
  . "$IDF_PATH/export.sh" >/dev/null
  idf.py -C /opt/stmweb/adapters/cardputer-adv \
    -B /tmp/stmweb-cardputer-adv \
    -DSDKCONFIG=/tmp/stmweb-cardputer-adv.sdkconfig \
    -DSTMWEB_COMPOSITION_FILE=/source/cardputer-adv-composition.json \
    build
  test -s /tmp/stmweb-cardputer-adv/cardputer_adv_complete.bin
  test -s /tmp/stmweb-cardputer-adv/cardputer_adv_ota.bin
  test -s /tmp/stmweb-cardputer-adv/stmweb_firmware_manifest.json
  grep -a -q "STMWEB_ADAPTER:stmweb.cardputer-adv" /tmp/stmweb-cardputer-adv/cardputer_adv_ota.bin
  node -e "const fs=require(\"fs\");const m=JSON.parse(fs.readFileSync(\"/tmp/stmweb-cardputer-adv/stmweb_firmware_manifest.json\"));if(m.adapter.id!==\"stmweb.cardputer-adv\"||m.hardware.target!==\"esp32s3fn8\"||m.artifacts.length!==2)process.exit(1)"
')
docker cp "$SOURCE_ROOT/." "$CONTAINER_ID:/source/smoke-source"
docker cp "$REPOSITORY_ROOT/scripts/verify-dot-initial-firmware.mjs" "$CONTAINER_ID:/source/verify-dot-initial-firmware.mjs"
docker cp "$REPOSITORY_ROOT/tests/fixtures/dot-composition-bluetooth.json" "$CONTAINER_ID:/source/dot-composition-bluetooth.json"
docker cp "$REPOSITORY_ROOT/tests/fixtures/dot-composition-wired.json" "$CONTAINER_ID:/source/dot-composition-wired.json"
docker cp "$REPOSITORY_ROOT/tests/fixtures/cardputer-adv-composition.json" "$CONTAINER_ID:/source/cardputer-adv-composition.json"
docker start --attach "$CONTAINER_ID"
docker container rm "$CONTAINER_ID" >/dev/null
CONTAINER_ID=""

printf 'firmware_compiler_real_build=ok\nfirmware_compiler_image=%s\n' "$IMAGE"

#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_root=${1:-"$repository_root/input/DOT-V1.0/标准版源代码/V1.0"}
output_root=${2:-"$repository_root/output/firmware/dot-v1"}

cmake -S "$repository_root/firmware-adapters/dot-v1" -B "$output_root" -G Ninja \
  -DSTMWEB_TARGET=stm32f103cb \
  -DSTMWEB_SOURCE_ROOT="$source_root"
cmake --build "$output_root" --parallel 1
node "$repository_root/scripts/verify-dot-initial-firmware.mjs" "$output_root"

printf 'DOT 初始 SWD 固件：%s\n' "$output_root/dot_v1_initial_swd.hex"

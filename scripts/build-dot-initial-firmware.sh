#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_root=${1:-"$repository_root/input/DOT-V1.0/标准版源代码/V1.0"}
output_root=${2:-"$repository_root/output/firmware/dot-v1"}
compact_output_root="${output_root}-compact"

build_target() {
  local target=$1
  local target_output=$2
  cmake -S "$repository_root/firmware-adapters/dot-v1" -B "$target_output" -G Ninja \
    -DSTMWEB_TARGET="$target" \
    -DSTMWEB_SOURCE_ROOT="$source_root"
  cmake --build "$target_output" --parallel 1
  node "$repository_root/scripts/verify-dot-initial-firmware.mjs" "$target_output" "$target"
}

build_target stm32f103cb "$output_root"
build_target stm32f103c8 "$compact_output_root"

public_firmware_root="$repository_root/public/firmware/dot-v1"
cmake -E make_directory "$public_firmware_root"
cmake -E copy_if_different "$output_root/dot_v1_initial_swd.hex" "$public_firmware_root/dot_v1_initial_swd.hex"
cmake -E copy_if_different "$compact_output_root/dot_v1_initial_swd.hex" "$public_firmware_root/dot_v1_compact_initial_swd.hex"
cmake -E copy_if_different "$output_root/dot_v1.bin" "$public_firmware_root/dot_v1_application.bin"
cmake -E copy_if_different "$compact_output_root/dot_v1.bin" "$public_firmware_root/dot_v1_compact_application.bin"
chmod 0644 "$public_firmware_root/dot_v1_application.bin" "$public_firmware_root/dot_v1_compact_application.bin"

printf 'DOT 128 KiB 初始 SWD 固件：%s\n' "$output_root/dot_v1_initial_swd.hex"
printf 'DOT 64 KiB 紧凑初始 SWD 固件：%s\n' "$compact_output_root/dot_v1_initial_swd.hex"
printf 'DOT 128 KiB 蓝牙应用固件：%s\n' "$output_root/dot_v1.bin"
printf 'DOT 64 KiB 紧凑蓝牙应用固件：%s\n' "$compact_output_root/dot_v1.bin"

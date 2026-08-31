#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--build-dir", required=True)
parser.add_argument("--output", required=True)
arguments = parser.parse_args()

with open(os.path.join(arguments.build_dir, "flasher_args.json"), encoding="utf-8") as source:
    flasher = json.load(source)

command = [
    sys.executable,
    os.path.join(os.environ["IDF_PATH"], "components", "esptool_py", "esptool", "esptool.py"),
    "--chip", "esp32s3", "merge_bin", "-o", arguments.output,
    "--flash_mode", flasher["flash_settings"]["flash_mode"],
    "--flash_freq", flasher["flash_settings"]["flash_freq"],
    "--flash_size", flasher["flash_settings"]["flash_size"],
]
for offset, file_name in flasher["flash_files"].items():
    command.extend([offset, os.path.join(arguments.build_dir, file_name)])

subprocess.run(command, check=True)

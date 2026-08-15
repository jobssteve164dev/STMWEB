#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${1:-}"
OUTPUT_DIRECTORY="${2:-}"
SOURCE_REVISION="${3:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version" >&2; exit 2; }
[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source revision" >&2; exit 2; }
[[ -n "$OUTPUT_DIRECTORY" ]] || { echo "output directory is required" >&2; exit 2; }

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="stmweb/compiler:v$VERSION"
PACKAGE_NAME="stmweb-firmware-compilation-linux-amd64-$VERSION.tar.gz"
PACKAGE_ROOT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/stmweb-firmware-package.XXXXXX")"
cleanup() {
  find "$PACKAGE_ROOT" -xdev -depth -mindepth 1 -delete
  rmdir "$PACKAGE_ROOT"
}
trap cleanup EXIT
mkdir -p "$OUTPUT_DIRECTORY" "$PACKAGE_ROOT/bin" "$PACKAGE_ROOT/runtime"

docker build --platform linux/amd64 -t "$IMAGE" -f "$REPOSITORY_ROOT/runner/image/Dockerfile" "$REPOSITORY_ROOT"
docker run --rm --entrypoint node "$IMAGE" -e 'process.exit(Number(process.versions.node.split(`.`)[0]) >= 22 ? 0 : 1)'
docker run --rm --entrypoint arm-none-eabi-gcc "$IMAGE" --version >/dev/null
install -m 0755 "$REPOSITORY_ROOT/runner/install-runner-package.sh" "$PACKAGE_ROOT/install-runner-package.sh"
install -m 0755 "$REPOSITORY_ROOT/runner/stmweb-runner.mjs" "$PACKAGE_ROOT/bin/stmweb-runner.mjs"
bash "$REPOSITORY_ROOT/scripts/export-classic-docker-archive.sh" "$IMAGE" "$PACKAGE_ROOT/runtime/image.tar.gz"

INSTALLER_SHA="$(sha256sum "$PACKAGE_ROOT/install-runner-package.sh" | cut -d' ' -f1)"
RUNNER_SHA="$(sha256sum "$PACKAGE_ROOT/bin/stmweb-runner.mjs" | cut -d' ' -f1)"
IMAGE_SHA="$(sha256sum "$PACKAGE_ROOT/runtime/image.tar.gz" | cut -d' ' -f1)"
python3 - "$PACKAGE_ROOT/package-manifest.json" "$VERSION" "$SOURCE_REVISION" "$IMAGE" "$INSTALLER_SHA" "$RUNNER_SHA" "$IMAGE_SHA" <<'PY'
import json, sys
target, version, revision, image, installer_sha, runner_sha, image_sha = sys.argv[1:]
manifest = {
    "schema_version": "1.0", "version": version, "source_revision": revision,
    "platform": "linux/amd64", "image": image,
    "minimum": {"cpu_cores": 1, "memory_mb": 1024, "disk_free_mb": 10240},
    "files": {
        "install-runner-package.sh": installer_sha,
        "bin/stmweb-runner.mjs": runner_sha,
        "runtime/image.tar.gz": image_sha,
    },
}
with open(target, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

PACKAGE_PATH="$OUTPUT_DIRECTORY/$PACKAGE_NAME"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -cf - -C "$PACKAGE_ROOT" install-runner-package.sh package-manifest.json bin runtime | gzip -n > "$PACKAGE_PATH"
PACKAGE_SHA="$(sha256sum "$PACKAGE_PATH" | cut -d' ' -f1)"
python3 - "$OUTPUT_DIRECTORY/manifest.json" "$VERSION" "$SOURCE_REVISION" "$PACKAGE_NAME" "$PACKAGE_SHA" "$IMAGE" <<'PY'
import json, sys
target, version, revision, package_name, package_sha, image = sys.argv[1:]
manifest = {
    "schema_version": "2.0", "version": version, "source_revision": revision,
    "packages": {"linux-amd64": {
        "status": "available",
        "minimum": {"cpu_cores": 1, "memory_mb": 1024, "disk_free_mb": 10240},
        "artifact": {"asset": package_name, "sha256": package_sha},
        "image": image,
    }},
}
with open(target, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
printf 'package=%s\npackage_sha256=%s\npackage_bytes=%s\nimage_archive_bytes=%s\nimage_bytes=%s\nimage_reference=%s\n' \
  "$PACKAGE_NAME" "$PACKAGE_SHA" "$(stat -c %s "$PACKAGE_PATH")" \
  "$(stat -c %s "$PACKAGE_ROOT/runtime/image.tar.gz")" "$(docker image inspect --format '{{.Size}}' "$IMAGE")" "$IMAGE" \
  > "$OUTPUT_DIRECTORY/build-evidence.txt"

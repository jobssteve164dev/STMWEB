#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${1:-}"
OUTPUT_DIRECTORY="${2:-}"
SOURCE_REVISION="${3:-}"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version" >&2; exit 2; }
[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source revision" >&2; exit 2; }
[[ -n "$OUTPUT_DIRECTORY" ]] || { echo "output directory is required" >&2; exit 2; }

IMAGE="stmweb/compiler:$VERSION"
ASSET="stmweb-compiler-$VERSION-linux-amd64.tar.gz"
mkdir -p "$OUTPUT_DIRECTORY"
docker image inspect "$IMAGE" >/dev/null
docker save "$IMAGE" | gzip -1 > "$OUTPUT_DIRECTORY/$ASSET"
ARCHIVE_SHA256="$(sha256sum "$OUTPUT_DIRECTORY/$ASSET" | cut -d' ' -f1)"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
IMAGE_SIZE="$(docker image inspect --format '{{.Size}}' "$IMAGE")"

node - "$OUTPUT_DIRECTORY/manifest.json" "$VERSION" "$SOURCE_REVISION" "$ASSET" "$ARCHIVE_SHA256" "$IMAGE" "$IMAGE_ID" <<'NODE'
const [target, version, sourceRevision, asset, sha256, image, imageId] = process.argv.slice(2);
await import("node:fs/promises").then(({ writeFile }) => writeFile(target, `${JSON.stringify({
  schemaVersion: 1, version, sourceRevision, platform: "linux/amd64",
  artifact: { asset, sha256 }, image, imageId,
  minimum: { cpuCores: 1, memoryMb: 1024, diskFreeMb: 2048 },
}, null, 2)}\n`));
NODE

printf 'platform=linux/amd64\narchive_bytes=%s\nimage_bytes=%s\nimage_id=%s\n' \
  "$(stat -c %s "$OUTPUT_DIRECTORY/$ASSET")" "$IMAGE_SIZE" "$IMAGE_ID" > "$OUTPUT_DIRECTORY/build-evidence.txt"

#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIRECTORY="${1:-}"
[[ -d "$RELEASE_DIRECTORY" ]] || { echo "release directory is required" >&2; exit 2; }
REPOSITORY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MANIFEST="$RELEASE_DIRECTORY/manifest.json"
[[ -s "$MANIFEST" ]] || { echo "manifest.json is missing" >&2; exit 1; }

mapfile -t VALUES < <(python3 - "$MANIFEST" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
if manifest.get("schema_version") != "2.0": raise SystemExit("unsupported release manifest")
package = manifest["packages"]["linux-amd64"]
if package.get("status") != "available": raise SystemExit("package unavailable")
for value in (package["artifact"]["asset"], package["artifact"]["sha256"], package["image"], manifest["version"], manifest["source_revision"]): print(value)
PY
)
[[ "${#VALUES[@]}" -eq 5 ]] || { echo "release manifest contract is incomplete" >&2; exit 1; }
PACKAGE_NAME="${VALUES[0]}"; PACKAGE_SHA="${VALUES[1]}"; IMAGE="${VALUES[2]}"; VERSION="${VALUES[3]}"; SOURCE_REVISION="${VALUES[4]}"
[[ "$PACKAGE_NAME" == "stmweb-firmware-compilation-linux-amd64-$VERSION.tar.gz" ]] || { echo "package identity mismatch" >&2; exit 1; }
[[ "$PACKAGE_SHA" =~ ^[a-f0-9]{64}$ && "$SOURCE_REVISION" =~ ^[a-f0-9]{40}$ ]] || { echo "release identity invalid" >&2; exit 1; }
PACKAGE_PATH="$RELEASE_DIRECTORY/$PACKAGE_NAME"
printf '%s  %s\n' "$PACKAGE_SHA" "$PACKAGE_PATH" | sha256sum --check --strict

python3 - "$PACKAGE_PATH" "$VERSION" "$SOURCE_REVISION" "$IMAGE" <<'PY'
import hashlib, json, sys, tarfile
package_path, version, revision, image = sys.argv[1:]
required = {"install-runner-package.sh", "package-manifest.json", "bin/stmweb-runner.mjs", "runtime/image.tar.gz"}
def sha256_stream(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024): digest.update(chunk)
    return digest.hexdigest()
with tarfile.open(package_path, "r:gz") as package:
    members = package.getmembers(); names = {m.name.lstrip("./") for m in members if m.isfile()}
    if names != required or any(m.issym() or m.islnk() for m in members): raise SystemExit("package member set is invalid")
    by_name = {m.name.lstrip("./"): m for m in members}
    manifest = json.load(package.extractfile(by_name["package-manifest.json"]))
    if manifest.get("schema_version") != "1.0" or manifest.get("version") != version or manifest.get("source_revision") != revision: raise SystemExit("package identity mismatch")
    if manifest.get("platform") != "linux/amd64" or manifest.get("image") != image: raise SystemExit("runtime identity mismatch")
    if set(manifest.get("files") or {}) != required - {"package-manifest.json"}: raise SystemExit("package content map is invalid")
    for name, digest in manifest["files"].items():
        if sha256_stream(package.extractfile(by_name[name])) != digest: raise SystemExit(f"digest mismatch: {name}")
PY

RUNTIME_ARCHIVE="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/stmweb-runtime.XXXXXX.tar.gz")"
RUNNER_SCRIPT="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/stmweb-runner.XXXXXX.mjs")"
trap 'unlink "$RUNTIME_ARCHIVE"; unlink "$RUNNER_SCRIPT"' EXIT
tar -xOzf "$PACKAGE_PATH" runtime/image.tar.gz > "$RUNTIME_ARCHIVE"
tar -xOzf "$PACKAGE_PATH" bin/stmweb-runner.mjs > "$RUNNER_SCRIPT"
docker load --input "$RUNTIME_ARCHIVE" >/dev/null
[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE")" == "linux/amd64" ]] || { echo "runtime platform mismatch" >&2; exit 1; }
docker run --rm -i --platform linux/amd64 --entrypoint node "$IMAGE" --input-type=module - version < "$RUNNER_SCRIPT" >/dev/null
docker run --rm --platform linux/amd64 --entrypoint node "$IMAGE" -e 'process.exit(Number(process.versions.node.split(`.`)[0]) >= 22 ? 0 : 1)'
docker run --rm --platform linux/amd64 --entrypoint arm-none-eabi-gcc "$IMAGE" --version >/dev/null
bash "$REPOSITORY_ROOT/scripts/test-firmware-compiler-image.sh" "$IMAGE" "$RUNNER_SCRIPT"
printf 'verified_firmware_compilation_version=%s\nverified_source_revision=%s\nverified_package_sha256=%s\n' "$VERSION" "$SOURCE_REVISION" "$PACKAGE_SHA"

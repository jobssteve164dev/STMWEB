#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
PAIRING_CODE_FILE=""
PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PACKAGE_MANIFEST="$PACKAGE_ROOT/package-manifest.json"
INSTALL_ROOT="${STMWEB_INSTALL_ROOT:-/opt/stmweb-runner}"
STATE_ROOT="${STMWEB_STATE_ROOT:-/var/lib/stmweb-runner}"
SYSTEMD_UNIT_PATH="${STMWEB_SYSTEMD_UNIT_PATH:-/etc/systemd/system/stmweb-runner.service}"
CURRENT_STAGE="package_verify"

fail() {
  local code="${2:-${CURRENT_STAGE}_failed}"
  [[ "$code" =~ ^[a-z][a-z0-9_]*$ ]] || code="install_failed"
  printf 'STMWEB_RUNNER_INSTALL_FAILURE_CODE=%s\n' "$code" >&2
  if [[ -d "$STATE_ROOT" ]]; then
    printf 'failed:%s\n' "$CURRENT_STAGE" > "$STATE_ROOT/install-stage"
  fi
  printf '[STMWEB] 安装未完成：%s\n' "$1" >&2
  exit 1
}

record_stage() {
  CURRENT_STAGE="$1"
  if [[ -d "$STATE_ROOT" ]]; then printf '%s\n' "$CURRENT_STAGE" > "$STATE_ROOT/install-stage"; fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) [[ $# -ge 2 ]] || fail "--url 缺少地址" invalid_request; CONTROL_URL="$2"; shift 2 ;;
    --code-file) [[ $# -ge 2 ]] || fail "--code-file 缺少路径" invalid_request; PAIRING_CODE_FILE="$2"; shift 2 ;;
    *) fail "无法识别参数 $1" invalid_request ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "安装需要 root 权限" permission_denied
[[ "$(uname -s)/$(uname -m)" == "Linux/x86_64" ]] || fail "当前包只支持 Linux x86_64" runtime_architecture_incompatible
[[ "$CONTROL_URL" == "https://stmweb.szlk.uk" ]] || fail "控制面地址无效" invalid_request
[[ -s "$PAIRING_CODE_FILE" && ! -L "$PAIRING_CODE_FILE" ]] || fail "配对码文件无效" invalid_request
[[ -s "$PACKAGE_MANIFEST" ]] || fail "固件编译包内容清单缺失" package_manifest_missing
command -v python3 >/dev/null 2>&1 || fail "缺少 Python 3" package_verifier_missing
command -v docker >/dev/null 2>&1 || fail "缺少 Docker" docker_unavailable
command -v systemctl >/dev/null 2>&1 || fail "当前系统不支持 systemd" systemd_unavailable
docker info >/dev/null 2>&1 || fail "Docker 服务不可用" docker_unavailable

mkdir -p "$STATE_ROOT"
chmod 0700 "$STATE_ROOT"
record_stage package_verify

PACKAGE_VALUES="$(python3 - "$PACKAGE_ROOT" "$PACKAGE_MANIFEST" <<'PY'
import hashlib, json, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
required_top = {"schema_version", "version", "source_revision", "platform", "image", "minimum", "files"}
if set(manifest) != required_top or manifest["schema_version"] != "1.0" or manifest["platform"] != "linux/amd64":
    raise SystemExit("invalid package manifest contract")
required = {"install-runner-package.sh", "bin/stmweb-runner.mjs", "runtime/image.tar.gz"}
if set(manifest.get("files") or {}) != required:
    raise SystemExit("package file map is not exact")
actual = {str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()}
if actual != required | {"package-manifest.json"}:
    raise SystemExit("package member set is not exact")
for relative, expected in manifest["files"].items():
    path = (root / relative).resolve()
    if root not in path.parents or not path.is_file() or path.is_symlink():
        raise SystemExit(f"unsafe package member: {relative}")
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit(f"digest mismatch: {relative}")
with tarfile.open(root / "runtime/image.tar.gz", "r:gz") as archive:
    members = archive.getmembers()
    names = {member.name.lstrip("./") for member in members if member.isfile()}
    if "manifest.json" not in names or "repositories" not in names or not any(name.endswith("/layer.tar") for name in names):
        raise SystemExit("Docker archive metadata is incomplete")
    if any(member.issym() or member.islnk() for member in members):
        raise SystemExit("Docker archive contains links")
    docker_manifest = json.load(archive.extractfile(next(member for member in members if member.name.lstrip("./") == "manifest.json")))
    tags = {tag for item in docker_manifest for tag in item.get("RepoTags") or []}
    if manifest["image"] not in tags:
        raise SystemExit("Docker archive is missing the fixed image reference")
minimum = manifest["minimum"]
for key in ("cpu_cores", "memory_mb", "disk_free_mb"):
    if not isinstance(minimum.get(key), int) or minimum[key] <= 0:
        raise SystemExit("invalid minimum resource contract")
print(manifest["image"])
print(minimum["cpu_cores"])
print(minimum["memory_mb"])
print(minimum["disk_free_mb"])
PY
)" || fail "固件编译包内容验证失败" package_content_invalid
mapfile -t VALUES <<< "$PACKAGE_VALUES"
[[ "${#VALUES[@]}" -eq 4 ]] || fail "固件编译包内容清单不完整" package_manifest_invalid
BUILD_IMAGE="${VALUES[0]}"
(( $(getconf _NPROCESSORS_ONLN) >= VALUES[1] )) || fail "节点 CPU 不足" insufficient_cpu
(( $(awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo) >= VALUES[2] )) || fail "节点内存不足" insufficient_memory
(( $(df -Pm / | awk 'NR == 2 { print $4 }') >= VALUES[3] )) || fail "节点可用磁盘不足" insufficient_storage

EXISTING_REGISTRATION=0
if [[ -s "$STATE_ROOT/state.json" && ! -L "$STATE_ROOT/state.json" ]]; then
  python3 - "$STATE_ROOT/state.json" "$CONTROL_URL" <<'PY' \
    || fail "现有编译算力身份无效" runner_upgrade_unauthorized
import json, pathlib, re, sys
state = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if state.get("controlUrl") != sys.argv[2]: raise SystemExit(1)
if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", str(state.get("runnerId", "")), re.I): raise SystemExit(1)
if not isinstance(state.get("deviceToken"), str) or len(state["deviceToken"]) < 32: raise SystemExit(1)
PY
  EXISTING_REGISTRATION=1
fi

record_stage runtime_load
docker load --input "$PACKAGE_ROOT/runtime/image.tar.gz" >/dev/null || fail "编译镜像导入失败" runtime_load_failed
[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$BUILD_IMAGE" 2>/dev/null)" == "linux/amd64" ]] \
  || fail "编译镜像平台不匹配" runtime_architecture_incompatible
BUILD_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BUILD_IMAGE")"
docker run --rm --entrypoint node "$BUILD_IMAGE" -e 'process.exit(Number(process.versions.node.split(`.`)[0]) >= 22 ? 0 : 1)' \
  || fail "编译镜像缺少 Node.js 22" runtime_self_test_failed
docker run --rm --entrypoint arm-none-eabi-gcc "$BUILD_IMAGE" --version >/dev/null \
  || fail "编译镜像缺少 ARM GCC" runtime_self_test_failed
docker run --rm "$BUILD_IMAGE" sh -lc 'export IDF_PATH=/opt/esp/idf && . "$IDF_PATH/export.sh" >/dev/null && test "$(idf.py --version)" = "ESP-IDF v5.4.2"' \
  || fail "编译镜像缺少 ESP-IDF 5.4.2" runtime_self_test_failed

record_stage runner_install
install -d -m 0755 "$INSTALL_ROOT"
install -m 0755 "$PACKAGE_ROOT/bin/stmweb-runner.mjs" "$INSTALL_ROOT/stmweb-runner.mjs"
PAIRING_CODE="$(tr -d '\r\n' < "$PAIRING_CODE_FILE")"
[[ "$PAIRING_CODE" =~ ^[A-Za-z0-9_-]{6,64}$ ]] || fail "配对码格式无效" invalid_request
unset PAIRING_CODE
if [[ "$EXISTING_REGISTRATION" -eq 0 ]]; then
  docker run --rm --entrypoint node \
    -e STMWEB_BUILD_IMAGE="$BUILD_IMAGE" -e STMWEB_BUILD_IMAGE_ID="$BUILD_IMAGE_ID" \
    -v "$INSTALL_ROOT:$INSTALL_ROOT:ro" -v "$STATE_ROOT:$STATE_ROOT" \
    -v "$PAIRING_CODE_FILE:/run/stmweb-pairing-code:ro" \
    "$BUILD_IMAGE" "$INSTALL_ROOT/stmweb-runner.mjs" register \
    --url "$CONTROL_URL" --code-file /run/stmweb-pairing-code --state-dir "$STATE_ROOT" \
    || fail "编译 Runner 注册失败" runner_registration_failed
fi

cat > "$SYSTEMD_UNIT_PATH" <<EOF
[Unit]
Description=STMWEB firmware build runner
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Environment="STMWEB_BUILD_IMAGE=$BUILD_IMAGE"
Environment="STMWEB_BUILD_IMAGE_ID=$BUILD_IMAGE_ID"
ExecStart=/usr/bin/docker run --rm --name stmweb-runner-runtime --entrypoint node -e STMWEB_BUILD_IMAGE=$BUILD_IMAGE -e STMWEB_BUILD_IMAGE_ID=$BUILD_IMAGE_ID -v /var/run/docker.sock:/var/run/docker.sock -v $INSTALL_ROOT:$INSTALL_ROOT:ro -v $STATE_ROOT:$STATE_ROOT $BUILD_IMAGE $INSTALL_ROOT/stmweb-runner.mjs connect --state-dir $STATE_ROOT
ExecStop=-/usr/bin/docker stop stmweb-runner-runtime
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$STATE_ROOT /tmp

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable stmweb-runner
systemctl restart stmweb-runner
systemctl is-active --quiet stmweb-runner || fail "编译 Runner 服务未启动" service_start_failed
record_stage ready
printf 'STMWEB_FIRMWARE_COMPILATION_READY=1\n'

#!/usr/bin/env bash
set -euo pipefail

CONTROL_URL=""
PAIRING_CODE=""
BUILD_IMAGE=""
BUILD_IMAGE_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) CONTROL_URL="$2"; shift 2 ;;
    --code) PAIRING_CODE="$2"; shift 2 ;;
    --image) BUILD_IMAGE="$2"; shift 2 ;;
    --image-id) BUILD_IMAGE_ID="$2"; shift 2 ;;
    *) echo "不支持的参数：$1" >&2; exit 2 ;;
  esac
done

[[ -n "$CONTROL_URL" && -n "$PAIRING_CODE" && -n "$BUILD_IMAGE" && -n "$BUILD_IMAGE_ID" ]] || { echo "缺少 Runner 注册参数" >&2; exit 2; }
[[ "$BUILD_IMAGE" =~ ^[a-zA-Z0-9./:_@-]+$ ]] || { echo "编译镜像引用格式无效" >&2; exit 2; }
[[ "$BUILD_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "编译镜像摘要格式无效" >&2; exit 2; }
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { echo "第一版 Runner 需要 Linux x86_64" >&2; exit 1; }
command -v docker >/dev/null || { echo "需要可用的 Docker" >&2; exit 1; }
ACTUAL_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BUILD_IMAGE" 2>/dev/null || true)"
[[ "$ACTUAL_IMAGE_ID" == "$BUILD_IMAGE_ID" ]] || { echo "请先通过 GitOps Agent 产物代理安装已批准的编译环境" >&2; exit 1; }
docker run --rm --entrypoint node "$BUILD_IMAGE" -e 'process.exit(Number(process.versions.node.split(`.`)[0]) >= 22 ? 0 : 1)' \
  || { echo "编译环境缺少 Node.js 22" >&2; exit 1; }
docker run --rm --entrypoint unzip "$BUILD_IMAGE" -v >/dev/null \
  || { echo "编译环境缺少 unzip" >&2; exit 1; }
docker run --rm "$BUILD_IMAGE" sh -lc '. /opt/esp/idf/export.sh >/dev/null && idf.py --version' \
  || { echo "编译环境缺少 ESP-IDF 5.4.2" >&2; exit 1; }

INSTALL_ROOT="/opt/stmweb-runner"
STATE_ROOT="/var/lib/stmweb-runner"
install -d -m 0755 "$INSTALL_ROOT"
install -d -m 0700 "$STATE_ROOT"
curl -fL --retry 3 "$CONTROL_URL/runner/stmweb-runner.mjs" -o "$INSTALL_ROOT/stmweb-runner.mjs.download"
mv "$INSTALL_ROOT/stmweb-runner.mjs.download" "$INSTALL_ROOT/stmweb-runner.mjs"
chmod 0755 "$INSTALL_ROOT/stmweb-runner.mjs"
docker run --rm \
  --entrypoint node \
  -v "$INSTALL_ROOT:$INSTALL_ROOT:ro" \
  -v "$STATE_ROOT:$STATE_ROOT" \
  "$BUILD_IMAGE" \
  "$INSTALL_ROOT/stmweb-runner.mjs" register --url "$CONTROL_URL" --code "$PAIRING_CODE" --state-dir "$STATE_ROOT"

cat > /etc/systemd/system/stmweb-runner.service <<EOF
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
systemctl enable --now stmweb-runner
echo "编译算力已连接并启动"

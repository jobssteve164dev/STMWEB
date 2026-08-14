#!/usr/bin/env bash
set -euo pipefail

CONTROL_URL=""
PAIRING_CODE=""
BUILD_IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) CONTROL_URL="$2"; shift 2 ;;
    --code) PAIRING_CODE="$2"; shift 2 ;;
    --image) BUILD_IMAGE="$2"; shift 2 ;;
    *) echo "不支持的参数：$1" >&2; exit 2 ;;
  esac
done

[[ -n "$CONTROL_URL" && -n "$PAIRING_CODE" && -n "$BUILD_IMAGE" ]] || { echo "缺少 --url、--code 或 --image" >&2; exit 2; }
[[ "$BUILD_IMAGE" =~ ^[a-zA-Z0-9./:_@-]+$ ]] || { echo "编译镜像引用格式无效" >&2; exit 2; }
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { echo "第一版 Runner 需要 Linux x86_64" >&2; exit 1; }
command -v node >/dev/null && [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -ge 22 ]] || { echo "需要 Node.js 22 或更新版本" >&2; exit 1; }
command -v docker >/dev/null || { echo "需要可用的 Docker" >&2; exit 1; }
command -v unzip >/dev/null || { echo "需要 unzip" >&2; exit 1; }

INSTALL_ROOT="/opt/stmweb-runner"
STATE_ROOT="/var/lib/stmweb-runner"
install -d -m 0755 "$INSTALL_ROOT"
install -d -m 0700 "$STATE_ROOT"
curl -fL --retry 3 "$CONTROL_URL/runner/stmweb-runner.mjs" -o "$INSTALL_ROOT/stmweb-runner.mjs.download"
mv "$INSTALL_ROOT/stmweb-runner.mjs.download" "$INSTALL_ROOT/stmweb-runner.mjs"
chmod 0755 "$INSTALL_ROOT/stmweb-runner.mjs"
node "$INSTALL_ROOT/stmweb-runner.mjs" register --url "$CONTROL_URL" --code "$PAIRING_CODE" --state-dir "$STATE_ROOT"

cat > /etc/systemd/system/stmweb-runner.service <<EOF
[Unit]
Description=STMWEB firmware build runner
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Environment="STMWEB_BUILD_IMAGE=$BUILD_IMAGE"
ExecStart=/usr/bin/node $INSTALL_ROOT/stmweb-runner.mjs connect --state-dir $STATE_ROOT
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

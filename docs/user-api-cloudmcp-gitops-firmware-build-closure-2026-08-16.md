# STMWEB 用户 API → CloudMCP → GitOps 固件编译闭环记录

日期：2026-08-16  
状态：功能主链已闭环；旧 Provider Bridge 仍受零流量与人工删除确认门禁保护

可重复执行的正式操作技能：`$stmweb-user-api-runner-build`。技能覆盖正式目录刷新、唯一运行边界、生产配置、签名 Release、一次性配对、Action 安装、真实构建、失败诊断、运行对象归类与旧 Bridge 退役门禁。

## 1. 结论

STMWEB `.env` 中现有用户的唯一 `STMWEB_API`，已经通过 CloudMCP 私有适配器和 GitOps 通用 Runner Action，在唯一既有 Target `target-stmweb-firmware-compiler`、唯一绑定 Agent `ubuntu000-lucky` 上完成一次真实 STM32 固件编译。

STMWEB 对外仍只提供中立、用户鉴权的 `/api/v1`。Target、Agent、GitOps workspace、内部地址和 secret alias 均未写入 STMWEB 用户合同，也未转嫁给用户。公共 Agent、公共协议、公共 Action 类型和共享发布工作流均未为 STMWEB 增加专属分支。

## 2. 正式工具目录与唯一运行边界

正式 backend catalog refresh 和 `cloudmcp-connector reload codex` 完成后，`install_runner_action.action_kind` 的正式 schema 为：

```text
^[a-z][a-z0-9-]{1,63}$
```

该通用 schema 可直接接收 `firmware-compilation`，未通过修改公共 schema 绕过目录陈旧问题。

正式只读结果：

| 项目 | 结果 |
| --- | --- |
| Target | `target-stmweb-firmware-compiler` |
| Agent | `ubuntu000-lucky` |
| Agent 状态 | 在线 |
| Agent 版本 | `1.0.144` |
| CPU | 1 core |
| 内存 | 1024 MiB |
| 磁盘 | 10 GiB |
| GPU | 无 |
| 最大并发 | 1 |
| 调度 | enabled |
| 维护状态 | active |

未创建第二个 Target。安装前没有需要补偿清理的 firmware Action 残留。

## 3. STMWEB 生产配置

正式业务服务读回：

| 项目 | 结果 |
| --- | --- |
| 服务 | `stmweb-web-1` |
| Agent | `onex-nextterminal` |
| Compose project/service | `stmweb/web` |
| 状态 | running / healthy |
| 发布资产 | `stmweb-web-939.tar.gz` |
| 发布摘要 | `efdaed3e717b9ec70ee899c92027bb9338240ef9192e3cb9d53807e716de7f01` |
| `STMWEB_BUILD_IMAGE_ID` | 键存在且值非空 |

本轮没有向 STMWEB 写入 Target、Agent 或 GitOps 身份，也没有输出任何环境变量值或 secret。

## 4. firmware-compilation Action Release

独立 producer 发布结果：

| 项目 | 结果 |
| --- | --- |
| GitOps tag | `runner-action-firmware-compilation-v0.3.1` |
| Manifest schema | v2 |
| 不可变 STMWEB 源码 | `3ce39ba27e36b264d1ea2d75ea5898ca89d557fc` |
| 包 | `stmweb-firmware-compilation-linux-amd64-0.3.1.tar.gz` |
| 包大小 | 341,502,507 bytes（约 325.7 MiB） |
| 包 SHA-256 | `d2263476080b5fa33661a9c26982e243ac4fe4b43a18e9ff7e8e9dc451451220` |
| 签名 | 64-byte Ed25519 signature |
| Producer run | `31936088026`，success |
| 独立 published-bytes verification | `31936456707`，success |

Release 固定资产集完整：

- `manifest.json`：530 bytes
- `stmweb-firmware-compilation-linux-amd64-0.3.1.tar.gz`：341,502,507 bytes
- `stmweb-firmware-compilation-linux-amd64-0.3.1.tar.gz.sha256`：65 bytes
- `stmweb-firmware-compilation-linux-amd64-0.3.1.tar.gz.sig`：64 bytes
- `build-evidence.txt`：507 bytes

独立验证覆盖发布字节下载、包摘要、Ed25519 签名、最终 linux-amd64 archive 导入、运行时自检和临时下载清理。

### 包大小说明

Release 包不是 3GB。曾读到的 3.029GB 是 release Runner 的嵌套 Docker 数据卷，不是发布包。v0.3.0 为 341,501,414 bytes，v0.3.1 为 341,502,507 bytes，只增加 1,093 bytes。

包内包含可自包含运行的 ARM GCC/Newlib、Node.js 22、Docker CLI、CMake、Ninja、unzip、STMWEB Runner 和 firmware adapter；不包含 STMWEB 根目录大归档、PDF、OBJ 目录或完整仓库源码。

producer 的磁盘峰值问题已经限定在 firmware producer 内修复：同文件系统使用硬链接层、镜像解包后及时释放临时 Skopeo tar、最终 tar 直接流式写入 gzip，避免同时保留多份约 1.2GB 的中间数据。没有修改公共 Agent、公共协议或共享 workflow。

## 5. Runner Action 安装终态

一次性 pairing code 只传给以下正式调用：

```text
install_runner_action(
  runner_target_id=target-stmweb-firmware-compiler,
  action_kind=firmware-compilation
)
```

`STMWEB_API` 未交给 GitOps，pairing code 未写入日志或本文档。

| 项目 | 结果 |
| --- | --- |
| Runner Action ID | `runner-action:target-stmweb-firmware-compiler:firmware-compilation` |
| Operation ID | `exec-1786869352734122333` |
| 终态 | `ready` |
| Ready | `true` |
| STMWEB Runner ID | `a544d3cb-bb50-462c-92d6-dd12bec3f7db` |
| Runner name | `97c36bba854d` |
| Runner 状态 | online / idle |
| 编译环境 | `stmweb/compiler:v0.3.1` |
| 架构 | x64 |
| Target 能力 | `stm32f103c8`、`stm32f103cb` |
| 最大并发 | 1 |

v0.3.1 原位升级保持了既有 Runner ID，没有创建替代 Runner 或替代链。

## 6. 真实固件构建验收

构建身份：

| 项目 | 结果 |
| --- | --- |
| Build ID | `669129b0-c7f8-4f51-8c91-f0d436da9fbd` |
| Runner ID | `a544d3cb-bb50-462c-92d6-dd12bec3f7db` |
| Repository | `jobssteve164dev/STMWEB` |
| Source revision | `3ce39ba27e36b264d1ea2d75ea5898ca89d557fc` |
| Source content SHA-256 | `460754fa923ca17a9e76bee0fdd47800e2bc2568b5dd94b6ac4d4334d2de42d7` |
| Target | `stm32f103cb` |
| Profile | `stm32-cmake-gcc-v1` |
| 创建时间 | `2026-08-16T08:40:48.781Z` |
| 开始时间 | `2026-08-16T08:40:56.007Z` |
| 完成时间 | `2026-08-16T08:42:05.123Z` |
| 终态 | `succeeded` |
| 进度 | 100% |
| Error | null |

构建事件：

1. `accepted`：Runner 已接收并校验源码。
2. `started`：开始编译。
3. `completed`：构建完成，`artifactCount=6`。

制品读回：

| Kind | 名称 | 大小 | SHA-256 |
| --- | --- | ---: | --- |
| ELF | `dot_v1.elf` | 592,912 B | `1b7288de5135b7721f824c6394741deecb1388432c4c66da299ab2d1fcdb2959` |
| HEX | `dot_v1.hex` | 351,904 B | `8a408ca8b0c80e6688d2538874026d91783279126284f1cf97de0bd92a7cb2bb` |
| MAP | `dot_v1.map` | 572,650 B | `37d2a3e96f0841b87a64a3799de477846d53bdba3dce9bb8fbf6dd65d6b0401e` |
| BIN | `CMakeDetermineCompilerABI_C.bin` | 1,620 B | `823933f756ec9bbf7920dacafbd99d7f2e34bceebacba13d5db124278e1060c5` |
| BIN | `dot_v1.bin` | 125,092 B | `12b8542a65608f752c5ee6286a27b8e33b1bed37c4494f05f31acdbbff258ffc` |
| Log | `build.log` | 160,266 B | `9c2896bd2dd70550ba8a4a3b1641b1847e18eedc87f3155ff2cc85c5e4acc9e5` |

目录可见、accepted、queued 和 Action ready 均未被当作成功替代品；验收结论只建立在上述真实 `succeeded` 终态、事件和制品摘要之上。

## 7. 变更、验证与主线对应

### STMWEB

- `3c7055a5339c68d4384ab2db74fbc17661e5cf2f`：让构建临时目录与 build history 位于同一 Runner state filesystem，修复跨文件系统 `EXDEV`。
- `3ce39ba27e36b264d1ea2d75ea5898ca89d557fc`：限制 firmware Release 打包磁盘峰值。
- `npm run check`、专项 producer/Runner 合同检查和 pre-push 门禁通过。
- 当前 `main`、`origin/main` 均为 `3ce39ba...`，工作区干净。

### GitOps

- `7014ae4`：建立独立 firmware Action producer。
- `82acfb5`、`0a5fd74`：修正 GitOps 私有 firmware resolver 的受治理重定向处理。
- `610676ad1906fb6626601a5d3bc64fc78f8c261e`：允许完整节点存储扫描完成。
- 完整测试 638/638 通过；Control Plane Deploy `31935809945` 成功。
- 当前 `main`、`origin/main` 均为 `610676a...`，工作区干净。

### CloudMCP

- `c0259e2`：STMWEB 私有 adapter 对源码重定向执行边缘拒绝。
- 本闭环 Worker 版本：`1fff1533-81b4-4933-a742-e28cb0974f00`。
- 当前主线为并行 LLMWEB 清理后的 `ac41a97`，与 `origin/main` 对齐且工作区干净；本轮没有覆盖或回滚并行提交。

GitHub-hosted CI/Security 的零步骤失败属于账户 billing/spending limit 门禁，不是代码测试失败。GitOps 正式生产发布继续使用既有自托管链。

## 8. 运行对象归类

正式保留：

- v0.3.1 GitOps Release、tag 和五个发布资产。
- Runner Action、安装 operation 和脱敏日志审计记录。
- 成功构建 `669129b0-c7f8-4f51-8c91-f0d436da9fbd`、事件、日志和制品记录。
- 首次失败构建 `21ee06f1-c510-454e-b4e9-cfae261a79d1`，作为 `EXDEV` 根因证据保留。
- 首次 v0.3.1 发布失败 run `31934329988`，作为 ENOSPC 审计记录保留；它没有生成 tag 或 Release。

自动失效或已完成清理：

- 已使用的 pairing code 不再复用；未消费的升级 pairing code 按一次性 TTL 自动失效。
- producer/verification workflow 的临时下载和验证目录已由工作流清理。
- 节点存储维护 operation 已到终态，没有运行中的维护 Job。

本轮未删除历史 Release、tag、旧 Bridge 文件或 STMWEB 根目录大归档。

## 9. 旧 Provider Bridge 待退役清单

### 9.1 当前门禁

生产服务日志只包含进程启动记录，不记录 HTTP path；当前正式治理工具也没有 `/api/provider-bridge` 的逐路径请求统计。因此目前不能证明旧入口零流量，也不能用新 `/api/v1` 链路成功反推旧入口无人使用。

以下仅为精确待删除清单，不构成删除授权。必须先获得可审计的零流量证据，再展示当时的最终物理清单，并取得用户明确确认。

### 9.2 待物理删除文件

| 文件 | 当前大小 |
| --- | ---: |
| `server/cloudmcp-provider.ts` | 14,598 bytes |
| `tests/cloudmcp-provider.test.ts` | 1,999 bytes |
| `docs/cloudmcp-tools.md` | 3,485 bytes |

### 9.3 待移除引用与专属措辞

1. `server/index.ts`：移除 `cloudmcpProviderRouter` import 和 `/api/provider-bridge` mount；为未匹配的 `/api/*` 保留明确 JSON 404。
2. `server/env.ts`：移除旧 Bridge 配置字段。
3. `.env.example`：移除旧 Bridge 示例，并修正编译环境说明。
4. `docker-compose.yml`：移除旧 Bridge 环境变量注入。
5. `tests/api-connection-integration.test.ts`：移除 Provider Bridge 测试部分，保留 `/api/v1` 用户 API 验证。
6. `runner/install-runner-package.sh`：中立化 GitOps 结构化 marker。
7. `scripts/check-compiler-environment.mjs`：验证中立 marker，并禁止 `GITOPS_`、`CLOUDMCP_` 泄漏到最终 Runner 包。
8. `runner/install-runner.sh`、`runner/stmweb-runner.mjs`：移除 GitOps Agent 专属措辞。
9. `README.md`：移除旧 CloudMCP 工具合同链接和 GitOps 专属安装描述。
10. `docs/user-api-and-client-adapters.md`：更新为完成迁移后的中立基线。
11. `docs/v1-nearby-wireless-debugging.md`：改为客户端中立的受控分发说明。

### 9.4 待从生产配置移除的旧字段

只记录键名，不记录值：

- `CLOUDMCP_BASE_URL`
- `CLOUDMCP_BRIDGE_CLIENT_ID`
- `CLOUDMCP_BRIDGE_CLIENT_SECRET`
- `CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT`
- `STMWEB_CLOUDMCP_BRIDGE_CLIENT_ID`
- `STMWEB_CLOUDMCP_BRIDGE_CLIENT_SECRET`
- `STMWEB_CLOUDMCP_SOURCE_REPOSITORIES`

其中 `STMWEB_CLOUDMCP_SOURCE_REPOSITORIES` 当前仍被旧 Provider Bridge 路径读取，必须与旧路由同批退役，不能提前删除。

## 10. 最终状态

功能主链已经达到以下终态：

1. 通用 `install_runner_action` 可接收 `firmware-compilation`。
2. 唯一 Target、Agent 和预算正式读回正确。
3. 签名 firmware Action Release 已正式发布并完成独立验证。
4. 同一 Runner Action 原位升级到 ready。
5. STMWEB 用户 API 读回同一在线 Runner。
6. 一次真实固件构建成功，事件和六个制品 SHA-256 完整。
7. 三仓主线与远端同步，工作区无本轮残留。
8. 旧 Bridge 未删除；零流量证据和人工删除确认仍是独立退役门禁。

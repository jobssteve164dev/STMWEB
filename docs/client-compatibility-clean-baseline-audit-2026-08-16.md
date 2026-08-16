# STMWEB 客户端实现兼容清理与干净基线审计

状态：代码侧第一阶段吸收进行中；正式运行读回完成前禁止删除
审计日期：2026-08-16 UTC
审计范围：STMWEB 仓库内对 CloudMCP、GitOps 的实现兼容；后续经用户逐项授权后，补充记录 CloudMCP 私有 Adapter 与 GitOps 通用 Runner Action 注册实现

## 0. 当前实施证据（2026-08-16）

本节记录审计落盘后的实际代码进展，不覆盖后文退役门禁。当前只形成了代码与本地测试证据，尚未发布、dispatch 或在正式节点安装，因此三个待退役文件仍禁止删除。

### 0.1 STMWEB 中立 API

- 新增工作区约束的精确构建读取：`GET /api/v1/workspaces/:workspaceId/builds/:jobId`。
- 新增工作区约束的精确调试会话读取：`GET /api/v1/workspaces/:workspaceId/sessions/:sessionId`。
- 配对响应补齐结构化 `buildImage`、`buildImageId`；取消响应回读精确构建 ID、状态和 `desiredState`。
- API scope 映射已覆盖精确构建读取；类型检查与最窄 scope 回归通过。
- STMWEB 安装包的客户端专属 `GITOPS_STMWEB_*` 状态标记已改为中立 `STMWEB_*`，编译环境合同检查通过。

### 0.2 CloudMCP 私有 Adapter

- 六个既有工具名和输入 schema 保持不变，执行实现改为只调用 `/api/v1`，不再依赖 STMWEB 内嵌 Provider Bridge 或直连数据库。
- 聚合状态、Runner 配对、创建构建、精确构建读取、取消构建、精确调试会话读取均已形成逐项 Adapter 回归。
- GitHub 仓库 allowlist、完整 commit SHA 校验和 codeload 留在 CloudMCP 客户端侧；STMWEB API 不感知这些客户端策略。
- STMWEB 用户 API 凭证使用独立私有 secret alias 或 `STMWEB_API_TOKEN`，明确禁止复用旧 Provider Bridge shared secret；发往 STMWEB 的请求只有用户 Bearer，不发送 Bridge headers。
- CloudMCP 的公共 Provider Bridge registry、全局 Bridge 版本和 capability 定义未因该 Adapter 改动。

### 0.3 GitOps 通用 Runner Action 注册

- 经用户明确授权，公共 `install_runner_action` 的 `action_kind` 从单值枚举改为通用、受格式约束的注册键；工具名、参数名和返回身份保持不变。
- 新增内部 Runner Action 注册表。既有 `model-training` 适配器和资源下限原样注册；`firmware-compilation` 作为第二个私有适配器注册，不在公共工具 schema 中加入 STMWEB 字段。
- 模型训练继续复用既有 Agent `/runner-action/install` 路径；固件编译复用公共 Agent 已有 `/exec`、`secret_files`、`governed_downloads`、异步 job 和 `/exec/status`，未修改 Agent 代码或 Agent 协议。
- 固件安装对 Release manifest、包摘要、64 字节 Ed25519 签名、固定成员集和 tar 路径进行验证；配对码只进入 Agent 临时 secret file，不进入命令参数或环境变量。
- GitOps Agent 目录与共享工作流没有本轮 diff；没有创建第二个 Runner Target，也没有 dispatch、取消、重试或发布运行。

### 0.4 仍未闭环

- 尚无正式 CloudMCP 部署后的 `list_tools` 与六项真实调用读回。
- 尚未签发并配置当前用户的 STMWEB 用户 API 连接凭证到 CloudMCP 私有 secret binding。
- 尚未产生可供新 GitOps Adapter 消费的最终签名 `firmware-compilation` Release，也未在 `ubuntu000-lucky` 发起安装或读取 Agent job 终态。
- 构建通用来源元数据、幂等键、稳定错误 envelope、列表/事件分页及真实数据库 Bearer 集成仍是 API 完整吸收门禁。
- 因此本报告第 5 节三个文件仍不得删除，旧 `/api/provider-bridge` 也尚不能退役。

## 1. 本轮目标

把 STMWEB 收敛为只提供用户拥有、授权和撤销的中立 API，以及 STMWEB 自己的 Runner 协议与发行物。CloudMCP、GitOps、CLI、CI 和其他平台只能作为某个用户选择的外部客户端，在各自一侧实现适配；STMWEB 不保存它们的身份，不实现它们的工具协议，也不要求它们提供项目专属环境变量、请求头、Action 类型或节点对象。

本次清理先建立可验证的退役计划。现有 Provider Bridge 所承载的业务语义尚未全部被 `/api/v1` 吸收，在中立 API、独立 API 回归和客户端迁移证据齐全前，不删除旧入口。

## 2. 必须保持的不变量

- `/api/v1` 继续作为唯一正式用户 API，保留用户 API 连接、scope、工作区隔离、轮换、撤销和审计。
- STMWEB 继续拥有设备、调试会话、Runner、构建、事件和制品的业务事实。
- Runner 继续通过一次性配对材料注册，换取独立机器身份，并只通过出站 HTTPS 心跳、领取任务和回传结果。
- STMWEB 自己的编译环境、Runner、自包含安装包、内容摘要和固定安装入口继续属于 STMWEB 产品能力；任何客户端都可以消费同一包。
- STMWEB API、数据库和 Runner 协议中不得出现 CloudMCP workspace/connector、GitOps Target/Agent/节点或公共 Runner Action 字段。
- 不修改 CloudMCP Provider Bridge 公共合同、GitOps 公共 Agent、公共协议、公共 Action 类型或共享发布工作流。
- 不移动、删除、改写或推送根目录大归档 `stmweb-compiler-v0.2.0-linux-amd64.tar.gz`。
- 不修改 CloudMCP 仓库两份未跟踪旧适配文件。

## 3. 当前代码观察

### 3.1 已成立的中立产品基线

以下实现不依赖 CloudMCP 或 GitOps，应保留：

- `server/api-connection-auth.ts`：解析 `stmweb_api_*` 用户凭证，校验连接状态、scope 和精确工作区。
- `server/api.ts`：提供 `/api/v1` 设备、调试、Runner、构建和制品能力。
- `server/runner-api.ts`：提供 Runner 配对、机器鉴权、心跳、任务租约、事件和制品上传。
- `runner/stmweb-runner.mjs`：实现 STMWEB Runner 注册、主动领取、隔离编译和结果回传。
- `runner/install-runner-package.sh`、`scripts/build-firmware-compilation-release.sh`、`scripts/export-classic-docker-archive.sh`、`scripts/verify-firmware-compilation-release.sh`：能够形成 STMWEB 自己的自包含、摘要锁定安装包；状态标记已改为 STMWEB 中立标记。

`resolveApiConnectionCredential()` 虽然是在错误 Provider Bridge 改造中抽取出来的，但它现在也是 `/api/v1` Bearer 鉴权的单一实现，删除它会重新制造重复鉴权逻辑，因此保留。

### 3.2 CloudMCP 实现兼容污染

| 位置 | 当前行为 | 判定 |
| --- | --- | --- |
| `server/cloudmcp-provider.ts` | 在 STMWEB 内定义六个 MCP 工具、`{tool, params}` 协议、工具 scope 映射，并直接查询/修改 STMWEB 数据库 | 必须移除；它是第二套业务实现，不是 `/api/v1` 客户端 |
| `server/index.ts` | 挂载 `/api/provider-bridge` | 必须移除；STMWEB 不应托管 CloudMCP 工具协议 |
| `server/env.ts` | 接受三项 `CLOUDMCP_BRIDGE_*` 和 `STMWEB_CLOUDMCP_SOURCE_REPOSITORIES` | 必须移除；它们不是 STMWEB 产品运行条件 |
| `.env.example`、`docker-compose.yml` | 对外声明并注入上述 CloudMCP 变量 | 必须移除对应变量；不得留下不可达配置 |
| `tests/cloudmcp-provider.test.ts` | 把 STMWEB 内嵌 Provider Bridge 当作正式实现验证 | 必须移除 |
| `tests/api-connection-integration.test.ts` | 在用户 API 鉴权测试中额外挂载并验证 Provider Bridge | 精确删除 Bridge 部分，保留 `/api/v1` scope、工作区和撤销回归 |
| `docs/cloudmcp-tools.md` | 在 STMWEB 仓库保存 CloudMCP 工具目录、工具参数和旧 Bridge 迁移规则 | 应从 STMWEB 删除；MCP 工具契约应由 CloudMCP Adapter 所在仓库拥有 |
| `README.md` | 将 CloudMCP 工具兼容文档列为 STMWEB 正式参考 | 删除该入口，保留中立客户端边界文档 |

### 3.3 GitOps 实现兼容污染

| 位置 | 当前行为 | 处理 |
| --- | --- | --- |
| `runner/install-runner-package.sh` | 输出 `STMWEB_RUNNER_INSTALL_FAILURE_CODE` 和 `STMWEB_FIRMWARE_COMPILATION_READY` | 已改为 STMWEB 自有、客户端无关的结构化状态标记 |
| `scripts/check-compiler-environment.mjs` | 验证中立 `STMWEB_*` 标记并反向拒绝 `GITOPS_STMWEB_*` | 已完成代码侧清理 |
| `runner/install-runner.sh` | 错误文案要求先通过 GitOps Agent 安装环境 | 改为要求先安装摘要匹配的正式 STMWEB 编译环境，不指定客户端 |
| `runner/stmweb-runner.mjs` | 运行时错误文案把环境安装归因于 GitOps Agent | 改为只报告 STMWEB 编译环境身份不匹配 |
| `.env.example` | `STMWEB_BUILD_IMAGE_ID` 注释写成由 GitOps Agent 回填 | 改为由正式编译环境安装过程取得 |
| `README.md` | 把当前用户的 GitOps Target/产物代理写进产品运行说明 | 改成任意用户选择的脚本、CI 或节点平台均可安装同一正式环境 |
| `docs/v1-nearby-wireless-debugging.md` | 将国内 Runner 的唯一分发路径写成 GitOps Agent 代理 | 改成客户端无关的受控分发与本地摘要验证 |

### 3.4 默认保留但必须明确边界的内容

- `docs/user-api-and-client-adapters.md` 保留。它定义的是“外部平台只能作为用户客户端”的产品边界，不是 STMWEB 对这些平台的实现兼容。实际清理后需要把其中“旧 Provider Bridge 待迁移”的将来时改成已经退役的事实，不能继续把旧入口描述成可用路径。
- `docker-compose.yml` 顶层 `x-gitops` 暂时保留。它是当前生产部署描述，不参与 STMWEB 用户 API、Runner 协议或业务对象。删除它会改变现有生产发布入口，超出“撤掉客户端实现兼容”的范围；若用户要连生产部署元数据也迁出，应单独审计并授权。
- `STMWEB_BUILD_IMAGE` 与 `STMWEB_BUILD_IMAGE_ID` 暂时保留。它们表达 STMWEB 编译运行时身份，不应再写成由 GitOps 提供。后续若统一改成包摘要、签名和固定镜像引用，应作为独立的 STMWEB Runner 发行改造完成。
- `runner/install-runner-package.sh` 及其构建、验证脚本保留。自包含包是外部用户、CLI、CI 和任意节点平台共同消费的正确产品边界；只清除其中 GitOps 专属命名和假设。

## 4. 旧 Provider 能力吸收审计

### 4.1 六项工具逐项映射

| 旧工具 | 现有 `/api/v1` 映射 | 当前结论 | 删除前必须补齐 |
| --- | --- | --- | --- |
| `list_stmweb_debug_state` | 组合读取 `/bootstrap`、`/workspaces/:id/devices`、`runners`、`builds`、`sessions` | 业务数据已存在；聚合属于客户端职责 | 为各列表提供稳定分页；确认组合读取使用同一授权工作区 |
| `create_stmweb_runner_pairing` | `POST /workspaces/:id/runners/pairing` | 核心配对已存在，但响应仍混入固定镜像和安装命令假设 | 返回客户端无关的结构化配对材料、到期时间和 STMWEB 正式安装入口；安装命令只能作为便利展示，不是唯一合同 |
| `start_stmweb_firmware_build` | `POST /workspaces/:id/builds` 上传 ZIP | 只吸收了“创建构建”；旧工具的仓库 allowlist、完整 commit SHA、源码下载和来源回报仍在 Provider | STMWEB 接收客户端上传的不可变源码包并保存通用来源元数据、内容摘要和幂等键；GitHub allowlist/codeload 留在客户端 Adapter，不进入 STMWEB 专属协议 |
| `get_stmweb_firmware_build` | 当前只能先 `GET /workspaces/:id/builds`，再 `GET .../builds/:buildId/events` | 未完整吸收；列表最多 100 条，不能作为精确对象读取 | 新增精确 `GET /workspaces/:id/builds/:buildId`，返回状态、来源、Runner、错误、制品摘要和稳定 ID；事件单独分页读取 |
| `cancel_stmweb_firmware_build` | `POST /workspaces/:id/builds/:buildId/cancel` | 核心能力已吸收 | 增加稳定错误码、幂等取消语义、`request_id/operation_id`，并回读当前状态 |
| `get_stmweb_debug_session` | 当前只能先列 `/workspaces/:id/sessions`，再读 `/sessions/:sessionId/events` | 未完整吸收；缺少精确单会话读取 | 新增工作区约束的精确单会话 API，事件使用稳定分页和顺序语义 |

### 4.2 不应吸收进 STMWEB API 的内容

以下能力不能因为旧 Provider 删除而搬进 STMWEB：

- MCP 工具名、工具 schema、`{tool, params}` 请求结构和 `list_tools`。
- CloudMCP connector/workspace、Provider Bridge headers、Bridge 版本或 backend 身份。
- GitOps Target、Agent、节点、Action 类型、安装 Operation 或公共发布工作流字段。
- GitHub codeload 的调用方式和 CloudMCP 侧仓库 allowlist。STMWEB 只验证客户端上传的源码字节、通用来源声明、内容摘要和用户权限。
- 客户端侧把多个 API 结果聚合成一个工具响应的逻辑。

### 4.3 API 吸收完成证据

仅有新路由或单元测试不足以宣称吸收完成。必须同时证明：

1. 每项旧工具的业务动作都能仅通过 `/api/v1` 完成，不读取 Provider Bridge，也不直连数据库。
2. API Bearer 的 scope、工作区、撤销状态和对象归属对新路由全部生效。
3. 精确构建和调试会话读取不依赖“列出后搜索”。
4. 创建构建能保存内容摘要、通用来源身份和幂等身份，并在重试时不重复创建。
5. 错误返回具有稳定 `code`、安全 `message`、适用时的 `stage`、`request_id` 和 `operation_id`。
6. 独立外部测试客户端能够只使用正式 API 完成同一组动作；测试不得导入 STMWEB 服务端内部函数。
7. CloudMCP 私有 Adapter 已切到 `/api/v1`，正式工具读回与旧工具语义一致，并且不发送 Bridge headers 给 STMWEB。
8. 旧 `/api/provider-bridge` 无新连接、无非终态操作、无未迁移授权，并完成正式运行时流量与调用审计读回。

## 5. 《待退役物理文件清单》

以下均为本轮之前已经存在的受版本控制文件。它们当前仍承载尚未完全吸收或尚未完成客户端迁移的能力，因此现在禁止删除。只有第 4.3 节证据全部成立，并再次取得用户对同一精确清单的明确确认后，才可执行删除。

1. `/home/ubuntu/project/STMWEB/server/cloudmcp-provider.ts`
   - 证据：定义 STMWEB 内嵌 MCP 工具目录和 Provider Bridge 请求协议，并直接操作 STMWEB 数据库。
   - 删除理由：与 `/api/v1` 形成第二套业务实现，使 STMWEB 感知 CloudMCP。
2. `/home/ubuntu/project/STMWEB/tests/cloudmcp-provider.test.ts`
   - 证据：只验证上述内嵌 Provider Bridge 和 CloudMCP 环境合同。
   - 删除理由：实现移除后不再有合法被测对象。
3. `/home/ubuntu/project/STMWEB/docs/cloudmcp-tools.md`
   - 证据：保存 CloudMCP 具名工具、参数、源码仓库变量和旧 Bridge 迁移路径。
   - 删除理由：工具映射属于 CloudMCP 私有 Adapter，不能继续由 STMWEB 定义。

清单之外不得删除任何文件。特别禁止删除或移动根目录大归档。

## 6. 分阶段待精确编辑清单

### 6.1 第一阶段：先吸收 API，不删除旧入口

允许新增或精确编辑 STMWEB 中立 API、数据迁移和独立 API 测试，以完成第 4 节缺口。第一阶段不得修改旧 Provider Bridge 的公开行为，不得把 CloudMCP/GitOps 字段加入新 API，也不得修改三个待退役文件。

### 6.2 第二阶段：客户端切换与对照

由 CloudMCP 私有 Adapter 消费 `/api/v1` 并完成正式工具逐项对照；GitOps Adapter 另行处理节点安装，不参与本轮 STMWEB API 吸收。此阶段不允许为了适配客户端回写 STMWEB 专属协议。

### 6.3 第三阶段：证据齐全后清理旧实现

第 4.3 节全部通过并取得删除确认后，只允许编辑以下现有文件：

1. `server/index.ts`：删除 Provider Bridge import 和 `/api/provider-bridge` 挂载，并在静态前端 fallback 之前为未匹配 `/api/*` 增加明确 JSON 404，防止已退役 GET 路径回落到前端 `index.html`。
2. `server/env.ts`：删除 `CLOUDMCP_BRIDGE_CLIENT_ID`、`CLOUDMCP_BRIDGE_CLIENT_SECRET`、`CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT`、`STMWEB_CLOUDMCP_SOURCE_REPOSITORIES`。
3. `.env.example`：删除 CloudMCP 配置示例，改正编译环境身份注释。
4. `docker-compose.yml`：删除 web 服务的四项 CloudMCP 环境注入；保留顶层生产部署描述。
5. `tests/api-connection-integration.test.ts`：删除 Provider Bridge import、挂载与断言，保留完整 `/api/v1` 鉴权回归。
6. `runner/install-runner-package.sh`：将 GitOps 专属结构化标记改为 STMWEB 自有标记，不改变包布局、固定入口或安全校验。
7. `scripts/check-compiler-environment.mjs`：同步验证中立标记，并加入反向断言，禁止包和 Runner 再出现 `GITOPS_` 或 `CLOUDMCP_`。
8. `runner/install-runner.sh`、`runner/stmweb-runner.mjs`：删除 GitOps Agent 专属文案，保留相同失败条件。
9. `README.md`：移除 CloudMCP 工具契约链接和 GitOps 专属安装说明，保留用户 API 与中立客户端边界。
10. `docs/user-api-and-client-adapters.md`：把旧 Provider Bridge 的迁移描述改为清理后的基线事实，不改变外部客户端责任边界。
11. `docs/v1-nearby-wireless-debugging.md`：把 GitOps 唯一分发描述改为客户端无关的受控分发。

不编辑 `PROJECT_MEMORY.md`，直到代码清理和验证完成；届时只沉淀经最终代码与测试确认的稳定事实。

## 7. 回撤实施顺序

1. 先补齐中立 `/api/v1` 的精确对象读取、构建来源、幂等、稳定错误和操作关联能力。
2. 用独立 API 测试证明六项业务语义全部成立，并验证 scope、工作区、撤销和跨对象拒绝。
3. CloudMCP 私有 Adapter 切换到 `/api/v1`；通过正式治理工具逐项读回相同工具语义。
4. 只读确认旧入口无流量、无非终态操作和无未迁移授权。
5. 再次向用户展示第 5 节精确文件清单并取得删除确认。
6. 删除 STMWEB 内嵌 Provider Bridge 的入口、实现、专用测试和项目侧 CloudMCP 工具文档。
7. 删除 CloudMCP 环境变量在 schema、示例和 Compose 最终注入中的全部残留。
8. 将用户 API 集成测试恢复为只验证 `/api/v1`。
9. 保持已完成的安装包中立状态标记，并继续清理其余 GitOps 专属文案；产品包字节合同和功能不得退化。
10. 清理 README 与架构文档中的旧实现入口，保留客户端中立边界。
11. 运行源代码残留扫描、最窄测试、完整测试、类型检查、构建和依赖审计。
12. 在任何提交前复查 Git 状态，确保大归档既未变化，也未被本轮暂存或推送。

## 8. 干净基线验收标准

### 8.1 静态边界

- `server/`、`runner/`、`scripts/`、`tests/`、`.env.example` 和 Compose web 环境中不存在 `CLOUDMCP`、`provider-bridge`、`STMWEB_CLOUDMCP`、`GITOPS_STMWEB`。
- `/api/provider-bridge`、`/api/provider-bridge/help` 和 `/api/provider-bridge/v1/help` 的 GET/POST 都返回明确 404，不得返回旧工具目录或前端 `index.html`。
- `server/index.ts` 只挂载 STMWEB 自身鉴权、计费、用户 API、Runner API 和静态前端。
- Compose 最终环境不再包含 CloudMCP Bridge 配置。
- 允许 `docs/user-api-and-client-adapters.md` 以外部客户端示例提及 CloudMCP/GitOps，但不得描述 STMWEB 内建适配器、专属协议或可用旧入口。
- 允许 `docker-compose.yml` 顶层保留当前生产部署元数据，但应用运行时不得读取 GitOps 身份、Target、Agent 或节点字段。

### 8.2 功能守恒

- 用户 API Bearer 仍能访问获准工作区与 scope。
- 错 scope、错工作区和已撤销连接仍被拒绝。
- Runner 配对、机器鉴权、心跳、租约、事件和制品 API 仍可解析和构建。
- 自包含编译包仍包含精确成员集、内部摘要、固定镜像引用和固定安装入口。
- 包安装状态改名后，构建验证器与最终包内容保持一致。

### 8.3 建议验证命令

```bash
git grep -n -E 'CLOUDMCP|provider-bridge|STMWEB_CLOUDMCP|GITOPS_STMWEB' -- \
  server runner scripts tests .env.example docker-compose.yml
npm test
npm run check
npm audit --audit-level=high
git diff --check
```

若配置了隔离测试数据库，再运行真实 Bearer 集成测试，直接证明 scope、工作区与撤销行为未因清理退化。

## 9. 当前 Git 交付阻塞

当前本地 `main` 比 `origin/main` 多一个 SoloMap 自动备份提交 `81f8cb8`，该提交只加入了 407,871,736 字节的根目录大归档。此提交不是本轮产物，且用户明确禁止移动、提交或删除该归档。因此：

- 本审计文档可以先落在工作树并接受审阅；
- 在未取得用户对该既有提交的单独处置指令前，不把本轮文档或后续清理推送到 `origin/main`；
- 不使用 reset、checkout、rebase、amend 或其他方式改写该提交；
- 不把大归档加入本轮删除清单。

## 10. 实施门禁

下一步不是删除，而是为第 4 节缺口形成中立 API 的最小实现方案和测试矩阵。第 5 节三个文件在 API 吸收、CloudMCP 客户端切换和运行时清零证据全部完成前保持不动。未来的删除确认只授权删除清单中的三个文件，不授权删除归档、CloudMCP 未跟踪文件、历史 Release、GitOps Target 或任何运行对象。

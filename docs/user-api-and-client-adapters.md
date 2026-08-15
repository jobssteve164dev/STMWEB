# STMWEB 用户 API 与客户端适配器架构

## 1. 设计目标

STMWEB 对外提供一套由用户拥有、授权和撤销的正式 API。网页、CLI、用户自建自动化、第三方工具以及用户自己的 GitOps、CloudMCP，都通过同一套 API 使用设备连接、调试、Runner 算力、固件构建和制品能力。

STMWEB 不拥有、不内置、不调度也不假定 GitOps 或 CloudMCP。二者只是当前某个用户选择使用的私人平台；其他用户可以把自己的 STMWEB API 连接绑定到任意其他平台。任何客户端都不得要求 STMWEB 改写公共协议、增加隐藏入口或建立绕过用户授权的治理旁路。

本设计覆盖的不只是 Runner。所有原本通过 CloudMCP Provider Bridge 暴露的 STMWEB 专有工具能力，都应逐步收敛到 STMWEB 用户 API。

## 2. 第一性原则

1. **STMWEB API 是唯一正式产品能力面。** STMWEB 定义业务对象、参数、权限、状态、错误和版本。
2. **用户是 API 能力的所有者。** 每次调用都代表一个明确用户及其授权范围，不存在供客户端共享的全局 STMWEB 管理身份。
3. **所有工具都是客户端。** GitOps、CloudMCP、STMWEB Web、第三方应用和用户自建工具在业务权限上地位相同。
4. **客户端实现不改变 STMWEB。** 节点执行、产物代理、MCP 映射和协议转换留在用户所选平台的适配器内部，不进入 STMWEB 用户 API 的对象模型。
5. **一个业务事实源。** 设备、Runner、构建、调试会话、事件和制品以 STMWEB 数据为准；客户端不得维护第二套业务台账或状态机。
6. **授权只能收窄，不能放大。** CloudMCP workspace、GitOps 连接或第三方应用的权限不得超过授权用户在 STMWEB 中本来拥有的权限。

## 3. 系统关系

```text
用户 A 的身份与授权 → STMWEB API ← 用户 A 的 Web / CLI / Agent
                              ↑
                              ├─ 用户 A 自己的 CloudMCP + Adapter
                              └─ 用户 A 自己的 GitOps + Adapter + Runner Target

用户 B 的身份与授权 → STMWEB API ← 用户 B 选择的任意其他平台
```

GitOps 和 CloudMCP 是相同角色：二者都是某个用户私人环境中消费该用户 STMWEB API 的可选客户端。调用主动方始终是用户选择的平台，STMWEB 不反向发现、调用、编排或治理这些平台。GitOps 可以在自己的实现中执行节点安装或代理产物，CloudMCP 可以把 API 映射成 MCP tools，但这种实现差异不会赋予额外 STMWEB 权限，也不会产生另一套 STMWEB 契约。

“当前团队维护 GitOps 与 CloudMCP”不改变上述产品边界。它只意味着当前这个用户恰好拥有这两个私人平台，不意味着 STMWEB 的其他用户可以使用它们，也不意味着它们是 STMWEB 的中央基础设施。

## 4. 权威对象与数据归属

以下对象由 STMWEB 定义并持久化：

- 用户、工作区、成员关系与应用授权；
- 设备、固件能力描述、连接状态与控制租约；
- 调试会话、结构化事件、遥测索引与导出记录；
- Runner、注册状态、能力、心跳、租约与当前任务；
- 固件构建、阶段事件、日志、错误与取消状态；
- 固件制品、大小、摘要、目标硬件与来源身份；
- API 应用、令牌、scope、资源范围、撤销状态与审计记录。

用户自己的 GitOps 只保存自己的节点、Runner Target、执行任务和基础设施审计；用户自己的 CloudMCP 只保存自己的连接、工具映射、workspace 授权和调用审计。两者可以保存 STMWEB 稳定 ID 用于关联，但不得复制或接管 STMWEB 业务状态。STMWEB 不保存 GitOps 节点、Runner Target、CloudMCP workspace 或 connector 身份。

## 5. 用户授权模型

### 5.0 身份与支付边界

STMWEB 不建立独立的外部账号体系。用户注册、邮箱验证、密码登录、密码找回与账户身份以 SZLKPassport 为唯一权威来源；STMWEB 只保存不可变的 Passport 用户 ID、本地用户映射、工作区成员关系和自己的短期会话。既有内部管理员账号仅作为迁移期数据归属线索，不能继续作为新 API 连接的全局操作身份。

支付能力也由 SZLKPassport 提供。STMWEB 只消费属于 `stmweb` 产品的权威计费目录、创建结账链接和账户管理入口，不在代码或前台硬编码价格、权益或套餐真相。当前阶段先保留这些受登录会话保护的接口边界；在套餐、权益和用户动作正式确认前，不提前展示虚构的付费方案或用付费状态改变现有功能。

用户链路为：

```text
SZLKPassport 用户身份
→ STMWEB 本地用户映射
→ 工作区成员关系
→ 用户创建并授权 API 连接
→ CloudMCP / GitOps / 外部工具消费该用户 API
```

Passport 产品密钥只存在于 STMWEB 服务端，不能下发给浏览器、Runner 或客户端适配器。客户端适配器持有的是用户在 STMWEB 创建的连接凭证，不是 Passport 产品密钥。

### 5.1 客户端类型

STMWEB 支持两类用户控制的 API 连接：

- **授权应用**：适合 GitOps、CloudMCP 和第三方在线应用，采用授权码换取短期 access token，并使用可轮换 refresh token。
- **个人访问令牌**：适合 CLI、自建 Agent 和简单自动化，由用户创建、限定范围并随时撤销。

任何客户端都不能通过提交 `user_id`、用户名或 workspace 名称切换调用身份。用户身份必须来自 STMWEB 签发且已验证的连接凭证。

### 5.2 凭证绑定

每个授权至少绑定：

- 不可变的 STMWEB 用户身份；
- 客户端或应用身份；
- 允许的 scopes；
- 可选的工作区、项目或资源范围；
- 签发时间、到期时间和撤销状态；
- 凭证类型与轮换关系。

CloudMCP 还应在自身审计中关联 connector 与 workspace，但这些信息只能进一步限制访问，不能代替 STMWEB 用户身份或扩大权限。

### 5.3 建议 scopes

- `devices:read`
- `devices:connect`
- `devices:control`
- `debug:read`
- `debug:execute`
- `runners:read`
- `runners:manage`
- `builds:read`
- `builds:create`
- `builds:cancel`
- `artifacts:read`

scope 按用户动作划分，不按数据库表、内部路由、Provider 名称或部署机制划分。资源访问仍需在 scope 之后校验用户对具体工作区、设备、Runner、构建或制品的权限。

## 6. API 能力边界

第一版正式 API 至少覆盖以下领域：

### 6.1 能力与台账

- 查询当前用户可访问的设备、Runner、构建和调试会话；
- 查询设备能力描述、固件版本和在线状态；
- 查询 Runner 能力、最近心跳、当前租约和健康状态。

### 6.2 设备连接与调试

- 创建、读取和结束调试会话；
- 追加和分页读取结构化调试事件；
- 在持有有效控制租约时执行设备动作；
- 导出同一会话的可验证记录。

浏览器 USB、串口、HID 和蓝牙权限仍由用户当前电脑授予。云端 API 或任何客户端都不能绕过浏览器/操作系统授权直接取得附近硬件权限。

### 6.3 Runner 与构建

- 创建用户授权的 Runner 注册请求；
- 完成 Runner 注册并签发独立机器身份；
- 上报心跳、能力和当前任务；
- 创建、读取和取消固件构建；
- 领取和续租构建任务；
- 追加构建事件与日志；
- 完成构建并登记制品。

一次性配对材料只用于首次注册。注册成功后 Runner 使用绑定自身 `runner_id` 的可轮换机器凭证，不能读取其他 Runner、其他用户或未分配构建的数据。

### 6.4 制品

控制 API 只传递制品元数据和短期授权。大文件通过独立对象存储或受控代理传输，并至少绑定：

```text
user_id + workspace_id + build_id + artifact_type + digest + expiry
```

下载或上传授权不得接受调用者提供的任意回源 URL。源码、编译环境和输出制品都必须保留不可变来源、目标平台、大小和 SHA-256。

## 7. Runner 执行模型

第一版采用 Runner 主动出站连接：

1. 用户通过 STMWEB 创建 Runner 注册请求。
2. 已授权客户端可协助用户在目标节点完成安装，但安装动作仍绑定该用户和本次注册请求。
3. Runner 换取独立机器身份，只通过出站 HTTPS 发送心跳和领取任务。
4. STMWEB 按用户、工作区、Runner 能力和并发状态分配构建租约。
5. Runner 通过幂等事件序号回传阶段、日志和制品。
6. 租约超时或 Runner 重启后，STMWEB 根据同一构建 ID 和事件序号恢复或重新调度。

不要求用户开放节点入站端口，也不允许 STMWEB、GitOps 或 CloudMCP 通过隐藏 SSH/Agent 权限绕过用户 API 直接创建业务状态。

## 8. 统一观测链

每次用户动作生成稳定 `operation_id`；固件构建另有稳定 `build_id`。所有客户端和执行端在回传时保留这些身份，并使用 `trace_id` 关联跨系统调用。

构建阶段至少包括：

```text
queued
→ assigned
→ source_fetch
→ environment_verify
→ compiling
→ artifact_verify
→ uploading
→ succeeded | failed | cancelled
```

每个事件至少包含：

- `operation_id`、`build_id` 和 `runner_id`；
- 单调递增且可幂等去重的事件序号；
- 阶段、时间和非敏感进度摘要；
- 可行动的安全错误码；
- 适用时的字节进度、产物名称、大小与摘要。

STMWEB 向用户提供统一业务结果。客户端可以在自己的审计中记录适配或节点执行细节，但不能要求用户跨多个系统拼接结论。

## 9. 客户端适配器

本节定义的是分别部署在用户所选平台一侧的可选适配器，不是 STMWEB 内建服务。STMWEB 只维护标准 API 与通用客户端文档；任何用户都可以实现等价适配器，且不需要拥有 GitOps 或 CloudMCP。

### 9.1 CloudMCP Adapter

CloudMCP Adapter 部署在该用户自己的 CloudMCP 中，使用该用户明确授权的 STMWEB API 连接，将适合智能体使用的能力映射为 MCP tools。

它负责：

- 保存并轮换用户授权的 STMWEB 连接凭证；
- 将 CloudMCP connector/workspace 绑定到该连接；
- 把明确审核过的 STMWEB API 操作映射成工具；
- 保留用户身份、scope、资源范围和调用审计；
- 透传 STMWEB 的稳定业务 ID、状态和错误。

它不负责：

- 定义 STMWEB 业务状态机或错误分类；
- 使用全局管理密钥代表所有用户；
- 将任意新 API 无审核地自动暴露成工具；
- 经 GitOps Bridge 间接执行 STMWEB 业务动作；
- 维护第二份设备、Runner、构建或调试台账。

### 9.2 GitOps Adapter

GitOps Adapter 部署在该用户自己的 GitOps 中，并使用该用户授权的 STMWEB API 连接。它可以帮助完成节点安装、编译环境交付和 Runner 服务维护。用户在自己的 GitOps 中发起和审计基础设施动作；凡需读取或改变 STMWEB 业务状态的步骤，都由 Adapter 使用该用户的连接主动调用 STMWEB API。STMWEB 不调用该 Adapter，也不要求它存在。

它负责：

- 使用该用户的 STMWEB API 权限创建或读取 Runner 注册、状态与维护结果；
- 使用 GitOps 内部节点执行与产物代理能力完成基础设施动作；
- 以原 `operation_id` 回传进度和终态；
- 保持节点执行记录与 STMWEB Runner 身份可关联。

它不负责：

- 在 GitOps 公共 business lifecycle 中新增 `stmweb_*` 工具；
- 定义 `STMWEB_COMPILER_*` 公共环境合同；
- 为 STMWEB 增加公共 Provider Bridge 协议特例；
- 通过内部节点权限创建、修改或伪造 STMWEB 业务状态；
- 获得超过授权用户的设备、Runner 或构建访问权。

#### Runner Target 边界

对 GitOps 而言，接入 STMWEB 编译执行不新增 `STMWEB Runner` 这种公共治理对象，只是在该用户自己的 GitOps 中增加或复用一个普通 Runner Target。Runner Target 继续负责目标节点、资源边界、运行实例和基础设施状态；其内部工作负载驱动不得成为 STMWEB API 字段。

Runner Target 与 STMWEB Runner 是不同系统中的不同身份：

```text
用户私人 GitOps 的 runner_target_id
→ 解析节点与运行环境
→ 启动出站 Runner 进程
→ 该进程通过用户授权的 STMWEB API 完成注册
→ STMWEB 签发自己的 runner_id 与机器凭证
```

- `runner_target_id` 只存在于该用户自己的 GitOps，不上传给 STMWEB；
- `runner_id` 只表达 STMWEB 中的机器身份、心跳、租约和构建归属；
- Adapter 可以在自己的私有审计中关联二者，但不能把关联提升为 STMWEB 公共模型；
- 当前用户可以在自己的 GitOps 中把一个普通 Runner Target 绑定到 `ubuntu000-lucky`，这不赋予其他 STMWEB 用户任何该节点或 Target 的访问权；
- 其他用户可以用脚本、CI、另一种节点平台或手工方式运行完全相同的 STMWEB Runner，而无需 GitOps。

### 9.3 外部客户端

外部用户可以把自己的 IDE、CLI、Agent、CI 或第三方服务连接到自己的 STMWEB API。任何参考适配器都不得拥有其他客户端无法通过正式授权获得的业务能力。

### 9.4 主动调用与发现边界

- 用户在所选客户端平台中配置或授权自己的 STMWEB API 连接，客户端平台是调用发起方；
- STMWEB 不保存客户端平台地址，不发现客户端实例，也不向命名为 GitOps、CloudMCP 或其他产品的回调端点投递专属任务；
- 若未来提供事件通知，只能是所有用户和客户端均可使用的通用 webhook 或订阅能力，并由用户显式配置、授权和撤销；
- 客户端采用轮询、通用 webhook、队列还是人工触发，属于客户端私有实现，不改变 STMWEB API 对象和权限；
- STMWEB 的 API、SDK 和文档不得通过默认值或隐藏配置假定某个客户端平台存在。

### 9.5 实施仓库归属

- STMWEB 仓库只实现中立 API、OpenAPI、通用 SDK/Runner 协议和面向所有客户端的参考文档；
- CloudMCP 的连接保存、旧工具名兼容和 MCP 映射只在用户自己的 CloudMCP 侧实现；
- GitOps 的 Runner Target、节点调度、产物代理和 Adapter 只在用户自己的 GitOps 侧实现；
- 跨仓库联调使用公开 API 契约与用户授权凭证，不通过在任一公共契约中增加另一产品的专属字段完成。

## 10. 工具目录与版本

STMWEB API 使用明确版本，例如 `/api/v1`，并提供机器可读的 OpenAPI 描述。STMWEB 是字段、枚举、权限和错误语义的唯一来源。

客户端适配器应显式声明支持的 API 版本并维护审核过的映射，不能把 API 自动发现等同于自动公开。兼容规则为：

- 同一主版本只允许向后兼容扩展；
- 客户端必须容忍未知的新增响应字段；
- 删除字段、改变字段含义或收紧既有合法路径需要新主版本；
- 枚举扩展必须有旧客户端可处理的未知值策略；
- API 版本不与 GitOps、CloudMCP 或 Provider Bridge 的全局协议版本绑定。

## 11. 失败责任

- 用户权限、资源权限、配对、调度和业务状态由 STMWEB 负责。
- 客户端连接、令牌交换和协议映射失败由对应客户端适配器负责，并以同一操作 ID 回报。
- 使用 GitOps 的用户，其节点离线、安装或服务启动失败由该用户自己的 GitOps Adapter 观测；Adapter 可通过标准 API 回传与 Runner 注册有关的结果。未使用 GitOps 的用户由其所选平台承担同等责任。
- 编译命令、工具链验证和制品生成失败由 Runner 回传并由 STMWEB 归档。
- CloudMCP workspace 授权失败不能被转换成 STMWEB 用户权限失败，反之亦然。

任何系统都不能通过提前失败、隐藏日志、重建任务或另起旁路来制造“已处理”的状态。

## 12. 从旧 Bridge 迁移

迁移必须保持现有合法调用连续，不直接删除仍有调用者的工具。

1. 回撤错误加入 GitOps 公共契约的 STMWEB 专属入口及 CloudMCP 对这些入口的映射。
2. 盘点当前全部 `stmweb_*` 工具、调用者、授权、请求参数和返回语义。
3. 固化 STMWEB `/api/v1`、用户授权连接、scopes 和资源授权。
4. 让 STMWEB Web 使用同一业务 API，验证 API 足以覆盖真实用户主路径。
5. 在当前用户自己的 CloudMCP 中实现 Adapter，并对现有 MCP 工具做逐项语义兼容测试。
6. 在当前用户自己的 GitOps 中实现 Adapter；复用普通 Runner Target，通过用户授权的 API 完成 Runner 注册与维护。
7. 使用真实设备、真实 Runner 和真实固件构建验证完整观测链。
8. 将旧 Provider Bridge 入口切为只读迁移状态，停止接收新连接。
9. 确认无旧流量、无非终态操作和无未迁移授权后，再删除旧 Bridge 代码与配置。

历史授权、执行和部署记录作为审计证据保留，不通过物理删除伪造从未发生。临时镜像、安装文件或失败服务必须形成精确清单，经确认后由其所属系统安全清理。

## 13. 验收标准

- 用户可以创建、查看、缩小和撤销自己的 STMWEB API 连接。
- 当前用户自己的 CloudMCP、GitOps 和一个独立外部客户端能分别使用该用户 API 完成获准动作。
- 三类客户端在相同用户、scope 和资源范围下得到一致授权结果。
- 撤销连接后，所有后续调用立即失败，既有机器身份按独立生命周期处理。
- CloudMCP 和 GitOps 中不存在 STMWEB 专属公共协议字段或业务状态机。
- Web、API、MCP 映射和 Runner 对同一构建返回相同 `build_id`、阶段、日志与制品摘要。
- 当前用户自己的 GitOps 可将普通 Runner Target 绑定到 `ubuntu000-lucky`，其 Adapter 通过该用户正式授权完成 Runner 注册，并完成一次真实固件构建；STMWEB API 与数据库中不出现 Target 或 GitOps 节点字段。
- 构建失败时能从用户动作追踪到客户端、Runner、阶段、错误和残留对象。
- 外部用户无需了解 GitOps 或 CloudMCP，也能使用自己的工具接入全部获准 STMWEB 能力。

## 14. 已确认决策与待细化事项

已确认：

- 设计范围覆盖 Runner 及原 CloudMCP Bridge 中全部 STMWEB 专有工具能力；
- GitOps 与 CloudMCP 是某个用户自己拥有的可选私人平台，不是 STMWEB 的内部平台；
- 二者的适配器部署在各自平台一侧，并消费其所有者授权的 STMWEB API；STMWEB 不反向调用或治理它们；
- 外部用户可以自由绑定自己的工具；
- STMWEB 不再为特定客户端建立治理旁路或修改其公共契约；
- STMWEB 是全部业务对象、权限和状态的唯一事实源；
- 用户身份以 SZLKPassport 为唯一权威来源，STMWEB 只保存本地映射与会话；
- 支付目录、结账和账户管理能力由 SZLKPassport 提供，STMWEB 不硬编码套餐与价格。

实施前仍需细化：

- 授权码流程的回调绑定、PKCE、refresh token 轮换与撤销传播；
- 工作区与用户资源授权的精确关系；
- API 分页、速率限制、幂等键和错误码目录；
- Runner 任务租约、离线恢复和并发调度规则；
- 日志与制品的存储、保留和下载授权期限；
- 旧 MCP 工具到新 API 操作的逐项兼容矩阵。

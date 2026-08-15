# CloudMCP 硬件调试工具契约

> 本文记录现有工具语义，作为迁移兼容基线。目标架构已经调整为 CloudMCP 通过用户授权连接消费正式 STMWEB API；CloudMCP 不再通过项目专属 Provider Bridge 定义第二套契约。新边界与迁移顺序见 [STMWEB 用户 API 与客户端适配器架构](user-api-and-client-adapters.md)。

## 目标与边界

CloudMCP 让受授权的智能体直接完成 STMWEB 中已经具备服务端执行条件的调试与编译工作。STMWEB 仍是设备、调试会话、Runner、构建与制品的业务事实源。CloudMCP 作为内部客户端，必须使用某个用户授权的 STMWEB API 连接，并只负责 MCP 映射、连接治理和调用审计。

浏览器 USB、串口、HID、蓝牙权限属于用户当前电脑，云端工具不能绕过浏览器授权访问这些硬件。当前尚未具备设备侧控制租约和安全升级协议，因此第一批工具不发布远程控制或烧录动作；避免把“生成一条命令”冒充真实硬件闭环。

## 第一批工具

| 用户动作 | 工具 | 结果 |
| --- | --- | --- |
| 查看当前可做什么 | `list_stmweb_debug_state` | 设备、在线 Runner、最近构建、最近调试会话 |
| 接入一台编译节点 | `create_stmweb_runner_pairing` | 15 分钟一次性配对凭证与固定编译环境身份 |
| 编译一个固件提交 | `start_stmweb_firmware_build` | 绑定 Runner、受信任仓库、40 位 Git SHA、MCU 目标的构建 ID |
| 跟踪编译 | `get_stmweb_firmware_build` | 状态、进度、日志事件、错误、制品名称/大小/SHA-256 |
| 停止编译 | `cancel_stmweb_firmware_build` | 取消意图及当前状态 |
| 回看调试证据 | `get_stmweb_debug_session` | 会话身份与有序结构化事件 |

创建类调用只执行一次；后续使用返回的稳定 ID 轮询读取。源码必须来自 `STMWEB_CLOUDMCP_SOURCE_REPOSITORIES` 允许的 GitHub 仓库，并绑定完整 40 位提交 SHA。Provider 最多接收 16 MiB 源码归档，Runner 仍在无网络、1 CPU、1 GiB、只读根文件系统和移除 Linux capabilities 的固定容器内编译。

## 当前旧发布链与迁移边界

1. 现有 `/api/provider-bridge`、`/api/provider-bridge/v1/help` 和 `stmweb_hardware` backend 只作为迁移期间的兼容入口，不再代表目标架构。
2. 新实现先在 STMWEB `/api/v1` 中建立用户授权、资源授权和相同业务语义。
3. CloudMCP Adapter 使用用户授权连接映射上述工具，不使用全局共享 STMWEB 身份。
4. 新旧工具逐项完成参数、权限、状态、错误和结果兼容验证后，才切换真实调用。
5. 确认旧入口无流量、无非终态操作和无未迁移授权后，才退役旧 Provider Bridge。

## 后续烧录工具的解锁条件

只有同时满足以下条件才新增“请求设备操作、传输制品、确认烧录结果”等工具：

- 设备侧连接器或浏览器会话持有可验证、可过期的单一控制租约；
- 固件升级协议完成设备身份、目标 MCU、Flash 容量、固件哈希/签名、电池和电机停止检查；
- 分块传输、断点恢复、恢复 Bootloader 与重启后版本回报在真实设备上通过；
- 工具调用能回读同一操作 ID 的终态与审计事件，而不是依赖页面是否仍打开。

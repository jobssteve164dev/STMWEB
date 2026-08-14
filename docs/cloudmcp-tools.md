# CloudMCP 硬件调试工具契约

## 目标与边界

CloudMCP 让受授权的智能体直接完成 STMWEB 中已经具备服务端执行条件的调试与编译工作。STMWEB 仍是设备、调试会话、Runner、构建与制品的业务事实源，CloudMCP 只负责统一目录、鉴权、授权和路由。

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

## 发布链

1. STMWEB 以 `/api/provider-bridge` 暴露经共享密钥认证的 Provider，并以 `/api/provider-bridge/v1/help` 提供机器契约。
2. CloudMCP 将其注册为 `stmweb_hardware` backend，固定允许上述六个工具并声明超时和主体能力。
3. STMWEB 与 CloudMCP 分别部署后，CloudMCP 从 Provider 回读真实工具 schema。
4. STMWEB 项目空间通过一次精确工具授权审批获得六个工具，不使用通配符。
5. 以当前 Connector 实际发现和调用结果作为上线证据，Provider 帮助页或治理后台中的一行记录不能替代运行时验收。

## 后续烧录工具的解锁条件

只有同时满足以下条件才新增“请求设备操作、传输制品、确认烧录结果”等工具：

- 设备侧连接器或浏览器会话持有可验证、可过期的单一控制租约；
- 固件升级协议完成设备身份、目标 MCU、Flash 容量、固件哈希/签名、电池和电机停止检查；
- 分块传输、断点恢复、恢复 Bootloader 与重启后版本回报在真实设备上通过；
- 工具调用能回读同一操作 ID 的终态与审计事件，而不是依赖页面是否仍打开。

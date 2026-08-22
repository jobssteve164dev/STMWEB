# STMWEB

面向 STM32 智能硬件的浏览器调试工作台实验原型。

产品以标准化、高度自动化的固件生成运行时为主线：把用户的硬件描述和应用代码转换为可调试、可恢复、可通过长期 SWD 或硬件支持的无线方式烧录的标准固件包。完整设计见 [STMWEB 标准固件生成运行时设计](docs/standard-firmware-generation-runtime.md)。

当前阶段 B 已打通 DOT V1 的首个纵向切片：用户在固件管理中创建硬件项目，Runner 生成完整固件与应用固件，服务端依据实际字节验真并自动登记，再由用户发布稳定版并直接进入 SWD 或蓝牙烧录。第二种真实硬件尚未接入，因此当前实现仍是可扩展框架的首个样板，不宣称跨硬件通用。

第一版近距离无线接入、固件能力识别、动态调试组件、在线构建与安全升级的正式边界见 [第一版近距离无线硬件调试设计](docs/v1-nearby-wireless-debugging.md)。

STMWEB 用户 API、用户授权连接以及 GitOps、CloudMCP 和外部工具的统一客户端边界见 [STMWEB 用户 API 与客户端适配器架构](docs/user-api-and-client-adapters.md)。

按工作区隔离的通用设备注册、南向供给、北向授权调用与可靠执行结果边界见 [STMWEB 通用设备远程控制网关设计](docs/device-remote-control-gateway.md)。

现有 CloudMCP 工具迁移到用户授权 API 的兼容基线见 [CloudMCP 硬件调试工具契约](docs/cloudmcp-tools.md)。

## 第一版能力

- 使用 SZLKPassport 账号登录，STMWEB 保留本地工作区映射和安全会话。
- 会话存放在 PostgreSQL，并对所有工作区接口执行成员权限与同源写入校验。
- 统一入口连接串口、USB、HID 调试探针、蓝牙和局域网设备。
- 注册主动出站联网的远程设备，按设备和动作授权应用调用，并持续读取设备回报的真实执行结果。
- 自动检测当前浏览器能力，只在用户发起连接时请求系统授权。
- 接收并展示实时调试输出和遥测数据。
- 将设备台账、调试会话与全部事件写入 PostgreSQL，可跨浏览器查询并导出 JSON。
- 导入 `.bin`、`.hex`、`.elf`、`.axf`、`.srec` 固件，计算 SHA-256 后连同原文件保存为不可覆盖版本。
- 以工作区隔离设备台账、固件版本和会话记录。
- 无硬件时可以运行明确标识的演示会话，验证记录链路而不操作真实设备。
- 工作区可用一次性配对命令接入 Homelab x86 Runner，在无网络、1 CPU / 1 GiB 的固定编译容器内构建 STM32 源码并保存制品。
- 工作区可用一次性配对命令接入电脑端 Device Provider 示例，通过 HTTPS 长轮询验证远程设备注册、能力声明、操作领取、幂等回报和撤销链路。

## 本地运行

需要 Node.js 22、PostgreSQL 16+ 和 Chromium 系浏览器。先复制 `.env.example` 为 `.env`，配置数据库与 SZLKPassport 产品凭证。

```bash
npm install
npm run dev:server
```

服务启动时会执行幂等数据库迁移，然后访问 `http://127.0.0.1:8080`。若要热更新前端，可另开终端运行 `npm run dev` 并访问 `http://127.0.0.1:5173`。本机开发地址属于浏览器安全上下文；通过域名部署时必须使用 HTTPS，USB、串口、HID 和蓝牙授权发生在访问者自己的电脑上，而不是 Homelab 服务器上。

## Verify

```bash
npm run check
npm audit --audit-level=high
```

生产构建输出到 `dist/` 和 `dist-server/`，由 Node.js 服务统一提供页面、鉴权与 API。

公开产品首页位于 `/`，登录后的硬件调试工作台位于 `/workbench`，产品计划位于 `/plans`。页脚法律页面由服务端实时读取 SZLKLAWS 当前发布版本，仓库不保存法律正文副本；价格与结账计划由 SZLKPassport 统一提供。

编译 Runner 不需要 STMWEB 登录用户节点，也不需要开放节点入站端口。用户在“固件构建”中生成命令，并通过自己选择的脚本、CI、节点平台或人工方式在 x86 Linux 节点执行。节点必须预先安装与 `STMWEB_BUILD_IMAGE`、`STMWEB_BUILD_IMAGE_ID` 一致的编译镜像；当前用户可在自己的 GitOps 中使用普通 Runner Target 和产物代理完成安装，但这不是其他用户接入 STMWEB 的前提。

## 当前边界

DOT V1 已通过浏览器 WebHID（CMSIS-DAP v1）与 WebUSB Bulk（CMSIS-DAP v2）完成 64 KiB 实物 SWD 写入，并通过蓝牙完成后续应用升级。固件管理将 SWD 作为长期有线烧录路径，可用于安装、更新和恢复；蓝牙作为硬件支持时的并列应用升级方式。内置 DOT 固件由标准清单描述 64/128 KiB 完整镜像和应用镜像，用户导入制品由服务端根据实际字节计算摘要、识别目标和烧录方式，未适配制品不会进入烧录选择。其他 STM32 目标、ST-Link/J-Link/OpenOCD、断点与寄存器读写仍未实现。固件目前直接存入 PostgreSQL，适合内部首版；公共平台阶段应在保持现有版本模型的前提下迁移到对象存储。

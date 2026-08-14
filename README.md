# STMWEB

面向 STM32 智能硬件的浏览器调试工作台实验原型。

第一版近距离无线接入、固件能力识别、动态调试组件、在线构建与安全升级的正式边界见 [第一版近距离无线硬件调试设计](docs/v1-nearby-wireless-debugging.md)。

## 第一版能力

- 使用管理员预置的内部账号登录，不依赖外部身份服务，也不开放公开注册。
- 会话存放在 PostgreSQL，并对所有工作区接口执行成员权限与同源写入校验。
- 统一入口连接串口、USB、HID 调试探针、蓝牙和局域网设备。
- 自动检测当前浏览器能力，只在用户发起连接时请求系统授权。
- 接收并展示实时调试输出和遥测数据。
- 将设备台账、调试会话与全部事件写入 PostgreSQL，可跨浏览器查询并导出 JSON。
- 导入 `.bin`、`.hex`、`.elf`、`.axf`、`.srec` 固件，计算 SHA-256 后连同原文件保存为不可覆盖版本。
- 以工作区隔离设备台账、固件版本和会话记录。
- 无硬件时可以运行明确标识的演示会话，验证记录链路而不操作真实设备。
- 工作区可用一次性配对命令接入 Homelab x86 Runner，在无网络、1 CPU / 1 GiB 的固定编译容器内构建 STM32 源码并保存制品。

## 本地运行

需要 Node.js 22、PostgreSQL 16+ 和 Chromium 系浏览器。先复制 `.env.example` 为 `.env`，配置数据库、内部管理员账号和高强度密码。

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

编译 Runner 不需要平台登录 Homelab，也不需要开放节点入站端口。管理员在“编译与烧录”中生成命令并在 x86 Linux 节点执行。国内节点不在任务中直拉国外镜像：`Compiler image` 工作流生成带 SHA-256 和 image ID 的 amd64 产物，由 GitOps Agent 产物代理安装到节点；平台回填 `STMWEB_BUILD_IMAGE` 和 `STMWEB_BUILD_IMAGE_ID` 后才允许生成配对命令。

## 当前边界

第一版尚未实现 ST-Link/J-Link/OpenOCD 等真实探针协议、固件烧录、断点与寄存器读写。固件目前直接存入 PostgreSQL，适合内部首版；公共平台阶段应在保持现有版本模型的前提下迁移到对象存储。后续接入本地连接器时，前台仍保留同一个“连接设备”入口，让浏览器直连与连接器差异停留在实现层。

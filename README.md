# STMWEB

面向 STM32 智能硬件的浏览器调试工作台实验原型。

## 第一版能力

- 使用 GitHub OAuth 登录，不开放密码注册；只有服务端白名单中的账号可进入。
- 会话存放在 PostgreSQL，并对所有工作区接口执行成员权限与同源写入校验。
- 统一入口连接串口、USB、HID 调试探针、蓝牙和局域网设备。
- 自动检测当前浏览器能力，只在用户发起连接时请求系统授权。
- 接收并展示实时调试输出和遥测数据。
- 将设备台账、调试会话与全部事件写入 PostgreSQL，可跨浏览器查询并导出 JSON。
- 导入 `.bin`、`.hex`、`.elf`、`.axf`、`.srec` 固件，计算 SHA-256 后连同原文件保存为不可覆盖版本。
- 以工作区隔离设备台账、固件版本和会话记录。
- 无硬件时可以运行明确标识的演示会话，验证记录链路而不操作真实设备。

## 本地运行

需要 Node.js 22、PostgreSQL 16+ 和 Chromium 系浏览器。先复制 `.env.example` 为 `.env`，配置数据库、GitHub OAuth 应用和允许登录的邮箱；GitHub 回调地址是 `http://127.0.0.1:8080/api/auth/callback/github`。

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

## 当前边界

第一版尚未实现 ST-Link/J-Link/OpenOCD 等真实探针协议、固件烧录、断点与寄存器读写。固件目前直接存入 PostgreSQL，适合内部首版；公共平台阶段应在保持现有版本模型的前提下迁移到对象存储。后续接入本地连接器时，前台仍保留同一个“连接设备”入口，让浏览器直连与连接器差异停留在实现层。

# DOT V1 GCC 适配器

该目录把原始 Keil/ARMCC 工程适配为 Runner 可执行的 GCC/CMake 构建，原始业务源码不需要改写。

识别条件：源码包中存在 `USER/DOT.uvprojx`，设备为 `STM32F103CB`，并包含 DOT 控制模块。Runner 自动选择此适配器；其他 CMake 工程继续使用自己的根 `CMakeLists.txt`。

适配边界：

- 用 GNU 汇编启动文件替代 ARMASM 启动文件。
- 用独立兼容层实现原 `sys.c` 中的 ARMCC 汇编和系统函数。
- 为 Linux 大小写敏感文件系统提供三个头文件兼容入口。
- `stm32f103cb` 使用 128 KiB Flash 布局：16 KiB Bootloader、从 `0x08004000` 启动的应用以及末页初始化标记。
- `stm32f103c8` 使用 64 KiB 紧凑布局：4 KiB Bootloader、从 `0x08001000` 启动的 59 KiB 应用以及末页初始化标记；超容必须链接失败。
- 两个目标都生成 `dot_v1_initial_swd.hex`，供网页在 SWD 读回实际容量后自动选择。
- 两个目标的 `dot_v1.bin` 同时作为内置蓝牙应用固件发布；网页先读取 Bootloader 分区信息，再自动选择完全匹配的 64/128 KiB 版本。
- 构建脚本同时生成 `public/firmware/dot-v1/manifest.json`，以同一硬件适配 ID 描述两种容量、完整 SWD 镜像、应用镜像、烧录方式、大小和 SHA-256；网页只从该清单读取内置制品。
- 应用收到 `STMWEB:BOOT` 后先停止电机，再通过备份寄存器请求重启进入 Bootloader。Bootloader 使用原车 USART3（PB10/PB11、115200 8N1）接收带序号与 CRC32 的分块固件。
- 应用区域止于 `0x0801FC00`，最后 1 KiB 保存应用有效标记、长度和 CRC32；升级开始先清除该页，因此断电或传输中断不会启动残缺应用。

本地验证使用 ARM GNU Toolchain 14.2.1。CB 目标应用实际加载 90,276 字节，应用分区容量 113,664 字节；C8 紧凑目标用定长遥测格式化替代通用浮点文本运行库，在保留原车 LCD、VL53L0X、平衡控制、遥测和蓝牙升级入口的前提下，应用 `text + data` 为 53,044 字节，应用分区容量 60,416 字节；Bootloader 实际加载 2,128 字节。真实烧录前仍须完成上电运行验收。

两份 `dot_v1_initial_swd.hex` 目前都是 DOT V1 实物验证固件。第一次写入前必须由 SWD 探针读回 64/128 KiB 实际容量并选择完全匹配的布局；当前协议提供传输 CRC32 和失败恢复，制品签名与防回滚尚未完成前不得作为公共生产烧录协议。

## 蓝牙升级协议 v1

应用态经 USART3 收到 ASCII `STMWEB:BOOT` 后回复 `STMWEB:BOOTING` 并重启。进入 Bootloader 后，主机发送小端二进制帧：

| 字段 | 长度 | 含义 |
| --- | ---: | --- |
| magic | 4 | 固定为字节 `STMW` |
| version | 1 | 固定为 `1` |
| command | 1 | 命令编号 |
| sequence | 2 | 主机分配的帧序号 |
| offset | 4 | DATA 的应用内偏移；响应中为状态码 |
| length | 2 | payload 长度，最大 256 字节 |
| payload | length | 命令数据 |
| crc32 | 4 | 从 magic 到 payload 的标准 CRC32（多项式 `0xEDB88320`） |

命令顺序为 `HELLO(0x01)`、`BEGIN(0x02)`、若干 `DATA(0x03)`、`END(0x04)`；另有 `ABORT(0x05)` 和 `RUN(0x06)`。BEGIN payload 是应用长度和整包 CRC32，各 4 字节。DATA 必须从偏移 0 连续发送，除最后一包外长度必须为偶数；相同末包重传会幂等确认。响应命令为请求命令加 `0x80`，响应 offset 是 `stmweb_boot_protocol.h` 中的状态码。HELLO payload 依次返回 Flash 字节数、应用基址、应用容量、应用有效状态和编译目标 Device ID，共 20 字节；真实 `DBGMCU_IDCODE` 只由首次 SWD 连接在擦除前读取，因为部分 STM32F103 修订版在普通程序运行态读取该寄存器会返回 0。

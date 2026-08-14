# DOT V1 GCC 适配器

该目录把原始 Keil/ARMCC 工程适配为 Runner 可执行的 GCC/CMake 构建，原始业务源码不需要改写。

识别条件：源码包中存在 `USER/DOT.uvprojx`，设备为 `STM32F103CB`，并包含 DOT 控制模块。Runner 自动选择此适配器；其他 CMake 工程继续使用自己的根 `CMakeLists.txt`。

适配边界：

- 用 GNU 汇编启动文件替代 ARMASM 启动文件。
- 用独立兼容层实现原 `sys.c` 中的 ARMCC 汇编和系统函数。
- 为 Linux 大小写敏感文件系统提供三个头文件兼容入口。
- `stm32f103cb` 使用 128 KiB Flash 链接脚本；`stm32f103c8` 使用 64 KiB，超容必须链接失败。

本地验证使用 ARM GNU Toolchain 14.2.1。CB 目标成功生成 ELF、HEX、BIN、MAP；固件加载占用为 113,476 字节，RAM 静态占用为 5,360 字节。C8 目标按预期因 Flash 超出 45,304 字节失败。真实烧录前仍须核对实物 MCU 容量并完成上电运行验收。

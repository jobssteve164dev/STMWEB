# Cardputer ADV 固件适配

这是 STMWEB 面向 M5Stack Cardputer ADV 的 ESP-IDF 5.4.2 适配固件。首次安装使用 USB；安装完成后，同一个调试台可通过蓝牙连接设备、查看屏幕数字孪生与 56 键实时映射，并无线更新后续应用固件。

## 已实现的硬件路径

- ST7789V2 240 × 135 屏幕：GPIO 33–38，固件屏幕状态同步到调试台。
- TCA8418 键盘：GPIO 8/9，使用官方 `7 × 8` 扫描和 `4 × 14` 键位重映射。
- 电池：GPIO 10 / ADC1 Channel 9，定期上报电压与估算电量。
- 蓝牙：`FFF0` 服务，`FFF1` 通知，`FFF2` 写入；OTA 数据逐块写入备用分区并做 SHA-256 校验。

## 首次安装

Cardputer ADV 关机后按住 `G0`，接通 USB 电源后松开，即可进入官方固件下载模式。`cardputer_adv_complete.bin` 从地址 `0x0` 写入；无线更新使用 `cardputer_adv_ota.bin`，不要把完整镜像用于蓝牙升级。

蓝牙更新特征要求加密连接。每次开始无线更新前，用户还必须短按一次设备顶部 `G0`；授权窗口为 60 秒且只允许启动一次更新，连接中断会立即终止当前写入。

## 官方依据

- [M5Stack Cardputer-Adv 硬件文档](https://docs.m5stack.com/en/core/Cardputer-Adv)
- [M5Cardputer 官方驱动库](https://github.com/m5stack/M5Cardputer)
- [M5Cardputer-UserDemo 的 CardputerADV 分支](https://github.com/m5stack/M5Cardputer-UserDemo/tree/CardputerADV)

当前仓库能验证构建产物、分区与协议；屏幕方向、背光极性、电池换算和整机无线重启仍需要在真实 Cardputer ADV 上完成最终验收。

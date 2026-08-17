import { Check, CircleAlert, Cpu, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { flashDotInitialFirmware, parseDotInitialHex, type SwdFlashProgress, type SwdFlashResult } from "./cmsis-dap-swd.js";
import { useLocale } from "./i18n.js";

const initialFirmwareUrl = "/firmware/dot-v1/dot_v1_initial_swd.hex";

export function InitialSwdFlashPanel() {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SwdFlashProgress | null>(null);
  const [result, setResult] = useState<SwdFlashResult | null>(null);
  const [error, setError] = useState("");

  async function flash() {
    if (!window.confirm(c("即将擦除目标芯片并写入 DOT 初始固件。请确认 CMSIS-DAP 探针已通过 SWDIO、SWCLK、GND 与小车连接，并保持稳定供电。", "The target chip will be erased and the DOT bootstrap firmware installed. Confirm the CMSIS-DAP probe is connected to SWDIO, SWCLK and GND, and keep the vehicle powered."))) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(initialFirmwareUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(c("无法读取内置 DOT 初始固件", "The built-in DOT bootstrap firmware could not be loaded"));
      const firmware = parseDotInitialHex(await response.text());
      setResult(await flashDotInitialFirmware(firmware, setProgress));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c("初始固件写入失败", "Bootstrap flashing failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="initial-flash-card">
      <div className="initial-flash-icon"><Cpu size={24} /></div>
      <div className="initial-flash-copy">
        <span className="panel-kicker">{c("第一次连接", "First connection")}</span>
        <h2>{c("通过 SWD 安装无线升级入口", "Install wireless updates over SWD")}</h2>
        <p>{c("仅用于 DOT V1 / STM32F103CB。系统会先识别芯片型号和 128 KiB 容量，匹配后才会擦除并写入。", "For DOT V1 / STM32F103CB only. The chip identity and 128 KiB capacity are checked before any erase or write begins.")}</p>
        <div className="flash-safety"><ShieldCheck size={16} /><span>{c("写入完成后即可断开探针，后续更新使用蓝牙。", "After installation, disconnect the probe and use Bluetooth for future updates.")}</span></div>
        {progress ? <div className="flash-progress" aria-live="polite"><div><span>{progress.detail}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
        {result ? <div className="flash-result success"><Check size={17} /><span>{c(`初始固件已写入 · ${result.probeName} · 128 KiB`, `Bootstrap installed · ${result.probeName} · 128 KiB`)}</span></div> : null}
        {error ? <div className="flash-result error" role="alert"><CircleAlert size={17} /><span>{error}</span></div> : null}
      </div>
      <button className="primary-button" type="button" disabled={busy} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <Cpu size={17} />}{busy ? c("正在写入", "Flashing") : c("连接 SWD 并安装", "Connect SWD & Install")}</button>
    </article>
  );
}

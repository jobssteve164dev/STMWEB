import { Check, CircleAlert, Cpu, Loader2, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
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
  const [resetStep, setResetStep] = useState<"hold" | "release" | "release-after-failure" | null>(null);
  const resetAction = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  function waitForResetAction(step: "hold" | "release" | "release-after-failure") {
    setResetStep(step);
    return new Promise<void>((resolve, reject) => { resetAction.current = { resolve, reject }; });
  }

  function continueResetConnection() {
    resetAction.current?.resolve();
    resetAction.current = null;
    setResetStep(null);
  }

  function cancelResetConnection() {
    resetAction.current?.reject(new Error(c("已取消复位下连接，未擦除或写入芯片", "Connect-under-reset was cancelled. The chip was not erased or written.")));
    resetAction.current = null;
    setResetStep(null);
  }

  async function flash() {
    if (!window.confirm(c("即将擦除目标芯片并写入 DOT 初始固件。请确认 CMSIS-DAP 探针已通过 SWDIO、SWCLK、GND 与小车连接，并保持稳定供电。", "The target chip will be erased and the DOT bootstrap firmware installed. Confirm the CMSIS-DAP probe is connected to SWDIO, SWCLK and GND, and keep the vehicle powered."))) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(initialFirmwareUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(c("无法读取内置 DOT 初始固件", "The built-in DOT bootstrap firmware could not be loaded"));
      const firmware = parseDotInitialHex(await response.text());
      setResult(await flashDotInitialFirmware(firmware, setProgress, {
        holdReset: async () => {
          setProgress({ stage: "connecting", percent: 2, detail: c("等待按住小车 RESET", "Waiting for RESET to be held") });
          await waitForResetAction("hold");
          setProgress({ stage: "connecting", percent: 2, detail: c("保持 RESET，正在连接目标芯片", "Keep holding RESET while the target connects") });
        },
        releaseReset: async (targetDetected) => {
          setProgress({
            stage: "connecting",
            percent: 2,
            detail: targetDetected
              ? c("目标已响应，请松开 RESET", "Target detected, release RESET")
              : c("未检测到目标，请松开 RESET", "Target not detected, release RESET"),
          });
          await waitForResetAction(targetDetected ? "release" : "release-after-failure");
          if (targetDetected) setProgress({ stage: "connecting", percent: 2, detail: c("目标已响应，正在完成 SWD 连接", "Target detected, completing the SWD connection") });
        },
      }));
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
        {resetStep ? <div className="reset-connect-prompt" role="alertdialog" aria-live="assertive">
          <strong>{resetStep === "hold" ? c("现在按住小车 RESET，不要松开", "Press and keep holding the vehicle RESET button") : c("现在松开小车 RESET", "Release the vehicle RESET button now")}</strong>
          <p>{resetStep === "hold"
            ? c("按住后点击“我已按住”。网页会在复位状态下重新连接，出现下一步提示前请一直按住。", "While holding it, click “I'm holding RESET”. Keep holding until the next instruction appears.")
            : resetStep === "release"
              ? c("网页已经读到目标芯片。松开 RESET 后点击“已松开”，烧录将自动继续。", "The target responded. Release RESET, then click “Released” to continue automatically.")
              : c("复位状态下仍未检测到芯片。请先松开 RESET，再检查接线。", "The target did not respond while reset was held. Release RESET before checking the wiring.")}</p>
          <div className="reset-connect-actions">
            <button className="primary-button" type="button" onClick={continueResetConnection}>{resetStep === "hold" ? c("我已按住", "I'm holding RESET") : c("已松开", "Released")}</button>
            {resetStep === "hold" ? <button className="secondary-button" type="button" onClick={cancelResetConnection}>{c("取消", "Cancel")}</button> : null}
          </div>
        </div> : null}
        {progress ? <div className="flash-progress" aria-live="polite"><div><span>{progress.detail}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
        {result ? <div className="flash-result success"><Check size={17} /><span>{c(`初始固件已写入 · ${result.probeName} · 128 KiB`, `Bootstrap installed · ${result.probeName} · 128 KiB`)}</span></div> : null}
        {error ? <div className="flash-result error" role="alert"><CircleAlert size={17} /><span>{error}</span></div> : null}
      </div>
      <button className="primary-button" type="button" disabled={busy} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <Cpu size={17} />}{busy ? c("正在写入", "Flashing") : c("连接 SWD 并安装", "Connect SWD & Install")}</button>
    </article>
  );
}

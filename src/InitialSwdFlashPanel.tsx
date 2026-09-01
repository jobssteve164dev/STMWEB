import { Check, CircleAlert, Cpu, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flashDotInitialFirmware, parseDotInitialHex, requestCmsisDapProbe, type CmsisDapPacketTransport, type CmsisDapProbeKind, type SwdFlashProgress, type SwdFlashResult } from "./cmsis-dap-swd.js";
import { loadFirmwareContent, type FirmwareVersionRecord } from "./db.js";
import { loadBuiltInDotArtifacts } from "./firmware-manifest.js";
import { useLocale } from "./i18n.js";

const builtInFirmwareId = "built-in-dot-stable";

interface SwdFlashPanelProps {
  firmwareVersions: FirmwareVersionRecord[];
}

export function SwdFlashPanel({ firmwareVersions }: SwdFlashPanelProps) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SwdFlashProgress | null>(null);
  const [result, setResult] = useState<SwdFlashResult | null>(null);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState(builtInFirmwareId);
  const [resetStep, setResetStep] = useState<"hold" | "release" | "release-after-failure" | null>(null);
  const resetAction = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const savedSwdImages = useMemo(() => firmwareVersions.filter((item) => item.artifactRole === "complete-image" && item.flashMethods.includes("swd")
    && (item.status === "verified" || item.status === "stable")), [firmwareVersions]);

  useEffect(() => {
    if (savedId !== builtInFirmwareId && !savedSwdImages.some((item) => item.id === savedId)) setSavedId(builtInFirmwareId);
  }, [savedId, savedSwdImages]);

  async function selectedFirmwares() {
    if (savedId === builtInFirmwareId) {
      const firmwarePackage = await loadBuiltInDotArtifacts("complete-image", "swd");
      return firmwarePackage.artifacts.map((artifact) => parseDotInitialHex(new TextDecoder().decode(artifact.bytes), artifact.flashSize === 64 * 1024 ? 64 : 128));
    }
    const saved = savedSwdImages.find((item) => item.id === savedId);
    if (!saved || (saved.flashSize !== 64 * 1024 && saved.flashSize !== 128 * 1024)) throw new Error(c("请选择可用于当前 DOT 的 SWD 固件", "Choose SWD firmware compatible with this DOT"));
    const bytes = await loadFirmwareContent(saved.id);
    return [parseDotInitialHex(new TextDecoder().decode(bytes), saved.flashSize === 64 * 1024 ? 64 : 128)];
  }

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

  async function flash(probeKind: CmsisDapProbeKind) {
    setBusy(true); setError(""); setResult(null);
    let selectedTransport: CmsisDapPacketTransport | undefined;
    try {
      setProgress({ stage: "connecting", percent: 1, detail: c("请选择与小车连接的调试探针", "Choose the debug probe connected to the vehicle") });
      selectedTransport = await requestCmsisDapProbe(probeKind);
      const selectedName = savedId === builtInFirmwareId ? c("DOT 完整稳定版（含 Bootloader）", "DOT complete stable firmware (includes Bootloader)") : savedSwdImages.find((item) => item.id === savedId)?.fileName ?? c("所选固件", "the selected firmware");
      if (!window.confirm(c(`即将通过 SWD 写入 ${selectedName}。请确认 CMSIS-DAP 探针已连接 SWDIO、SWCLK、GND，并保持设备稳定供电。`, `The selected firmware will be written over SWD. Confirm the CMSIS-DAP probe is connected to SWDIO, SWCLK and GND, and keep the device powered.`))) {
        await selectedTransport.close();
        selectedTransport = undefined;
        setProgress(null);
        return;
      }
      const firmwares = await selectedFirmwares();
      setResult(await flashDotInitialFirmware(firmwares, setProgress, {
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
      }, selectedTransport));
      selectedTransport = undefined;
    } catch (caught) {
      const cancelled = caught instanceof DOMException && caught.name === "NotFoundError";
      setError(cancelled
        ? probeKind === "hid"
          ? c("未选择 DAPLink / CMSIS-DAP。请在系统设备窗口中选择新探针；如果使用 SLogic Combo8，请点击下方专用入口。", "No DAPLink / CMSIS-DAP was selected. Choose the new probe in the system picker, or use the SLogic Combo8 option below.")
          : c("未选择 SLogic Combo8。请确认探针已连接电脑后重试。", "No SLogic Combo8 was selected. Connect the probe to this computer and try again.")
        : caught instanceof Error ? caught.message : c("SWD 烧录失败", "SWD flashing failed"));
    } finally {
      if (selectedTransport) await selectedTransport.close().catch(() => undefined);
      setBusy(false);
    }
  }

  return (
    <article className="workbench-card firmware-flash-widget">
      <div className="widget-heading"><div><Cpu size={18} /><strong>{c("SWD 烧录", "SWD flashing")}</strong></div><span className="widget-state offline"><i />{c("连接时选择探针", "Choose probe on connection")}</span></div>
      <p>{c("选择要通过 SWD 烧录的完整固件。系统会先识别芯片与 Flash 容量，完全匹配后才会擦除并写入。", "Choose the complete image to flash over SWD. The chip and flash capacity are checked before a matching image is erased or written.")}</p>
      <div className="firmware-flash-source"><label><span>{c("烧录固件", "Firmware")}</span><select value={savedId} disabled={busy} onChange={(event) => setSavedId(event.target.value)}><option value={builtInFirmwareId}>{c("DOT 完整稳定版（含 Bootloader，自动匹配）", "DOT complete stable firmware (includes Bootloader, automatic match)")}</option>{savedSwdImages.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label></div>
      <div className="flash-safety"><ShieldCheck size={16} /><span>{c("写入前会再次核对目标芯片和容量。", "The target chip and capacity are checked again before writing.")}</span></div>
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
        {result ? <div className="flash-result success"><Check size={17} /><span>{c(`SWD 烧录完成 · ${result.probeName} · ${result.flashSize / 1024} KiB`, `SWD flashing complete · ${result.probeName} · ${result.flashSize / 1024} KiB`)}</span></div> : null}
        {error ? <div className="flash-result error" role="alert"><CircleAlert size={17} /><span>{error}</span></div> : null}
      <div className="initial-flash-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={() => void flash("hid")}>{busy ? <Loader2 className="spinning" size={17} /> : <Cpu size={17} />}{busy ? c("正在连接", "Connecting") : c("连接 DAPLink 并烧录", "Connect DAPLink & Flash")}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void flash("slogic-combo8")}>{c("使用 SLogic Combo8", "Use SLogic Combo8")}</button>
      </div>
    </article>
  );
}

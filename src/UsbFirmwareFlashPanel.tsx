import { Check, CircleAlert, Loader2, Usb } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadFirmwareContent, type DebugEventRecord, type FirmwareVersionRecord } from "./db.js";
import { flashFirmwareOverUsb, type UsbFlashProgress } from "./esp-usb-flasher.js";
import { useLocale } from "./i18n.js";

interface Props {
  firmwareVersions: FirmwareVersionRecord[];
  onEvent: (level: DebugEventRecord["level"], message: string, payload?: DebugEventRecord["payload"]) => void;
}

export function UsbFirmwareFlashPanel({ firmwareVersions, onEvent }: Props) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const firmwares = useMemo(() => firmwareVersions.filter((item) => item.artifactRole === "complete-image" && item.flashMethods.includes("usb")
    && (item.status === "verified" || item.status === "stable")), [firmwareVersions]);
  const [selectedId, setSelectedId] = useState(firmwares[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UsbFlashProgress | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const usbSupported = typeof navigator !== "undefined" && "serial" in navigator;

  useEffect(() => {
    if (!firmwares.some((item) => item.id === selectedId)) setSelectedId(firmwares[0]?.id ?? "");
  }, [firmwares, selectedId]);

  async function flash() {
    const selected = firmwares.find((item) => item.id === selectedId);
    if (!selected) { setMessage({ tone: "error", text: c("请先选择 USB 固件", "Choose USB firmware first") }); return; }
    if (!window.confirm(c("请关闭设备，按住顶部 G0，连接 USB 后松开 G0，再继续烧录。", "Turn the device off, hold G0, connect USB, then release G0 before continuing."))) return;
    setBusy(true); setMessage(null); setProgress(null);
    try {
      const bytes = await loadFirmwareContent(selected.id);
      onEvent("info", c(`开始 USB 烧录 · ${selected.fileName}`, `USB flashing started · ${selected.fileName}`), { fileName: selected.fileName, fileSize: bytes.byteLength });
      const result = await flashFirmwareOverUsb(selected, bytes, setProgress);
      setMessage({ tone: "success", text: c(`USB 烧录完成 · ${result.chipName}`, `USB flashing complete · ${result.chipName}`) });
      onEvent("success", c(`USB 烧录完成 · ${selected.fileName}`, `USB flashing complete · ${selected.fileName}`), { fileName: selected.fileName, chipName: result.chipName });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "NotFoundError";
      const text = cancelled ? c("未选择 USB 设备", "No USB device selected") : error instanceof Error ? error.message : c("USB 烧录失败", "USB flashing failed");
      setMessage({ tone: "error", text });
      if (!cancelled) onEvent("warning", text);
    } finally { setBusy(false); }
  }

  return <article className="workbench-card firmware-flash-widget">
    <div className="widget-heading"><div><Usb size={18} /><strong>{c("USB 烧录", "USB flashing")}</strong></div><span className={usbSupported ? "widget-state" : "widget-state offline"}><i />{usbSupported ? c("浏览器可用", "Browser ready") : c("浏览器不支持", "Unsupported browser")}</span></div>
    <p>{c("用于首次安装和恢复完整固件。选择固件后，浏览器会请求访问当前电脑连接的设备。", "Install or recover a complete firmware image. The browser requests access to a device connected to this computer.")}</p>
    <div className="firmware-flash-source"><label><span>{c("烧录固件", "Firmware")}</span><select value={selectedId} disabled={busy || !firmwares.length} onChange={(event) => setSelectedId(event.target.value)}><option value="" disabled>{c("选择 USB 完整固件", "Choose a complete USB image")}</option>{firmwares.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label></div>
    <div className="flash-preflight"><span className={usbSupported ? "ready" : "blocked"}>{usbSupported ? <Check size={14} /> : <CircleAlert size={14} />}{c("USB 串口", "USB serial")}</span><span className={firmwares.length ? "ready" : "blocked"}>{firmwares.length ? <Check size={14} /> : <CircleAlert size={14} />}{c("兼容固件", "Compatible firmware")}</span></div>
    {progress ? <div className="flash-progress" aria-live="polite"><div><span>{progress.detail}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
    {message ? <div className={`flash-result ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{message.text}</span></div> : null}
    <button className="primary-button" type="button" disabled={busy || !usbSupported || !firmwares.length} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <Usb size={17} />}{busy ? c("正在烧录", "Flashing") : c("连接 USB 并烧录", "Connect USB & flash")}</button>
  </article>;
}

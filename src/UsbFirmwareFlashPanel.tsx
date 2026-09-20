import { Check, CircleAlert, Loader2, Upload, Usb } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { loadFirmwareContent, type DebugEventRecord, type FirmwareVersionRecord } from "./db.js";
import { flashFirmwareOverUsb, readLocalUsbFirmware, usbFlashBaudRate, type UsbFlashProgress } from "./esp-usb-flasher.js";
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
  const [localFirmware, setLocalFirmware] = useState<{ record: FirmwareVersionRecord; bytes: Uint8Array } | null>(null);
  const [localSourceActive, setLocalSourceActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localFileBusy, setLocalFileBusy] = useState(false);
  const [baudRate, setBaudRate] = useState("460800");
  const [progress, setProgress] = useState<UsbFlashProgress | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const localSelectionRef = useRef(0);
  const usbSupported = typeof navigator !== "undefined" && "serial" in navigator;
  const baudRateValid = Number.isInteger(Number(baudRate)) && Number(baudRate) >= 9600 && Number(baudRate) <= 2_000_000;
  const hasSelectedFirmware = Boolean(localFirmware || firmwares.some((item) => item.id === selectedId));

  useEffect(() => {
    if (!localSourceActive && !firmwares.some((item) => item.id === selectedId)) setSelectedId(firmwares[0]?.id ?? "");
  }, [firmwares, localSourceActive, selectedId]);

  async function chooseLocal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const selection = ++localSelectionRef.current;
    setLocalSourceActive(true); setLocalFirmware(null); setSelectedId(""); setLocalFileBusy(true); setMessage(null);
    try {
      const firmware = await readLocalUsbFirmware(file);
      if (selection === localSelectionRef.current) setLocalFirmware(firmware);
    } catch (error) {
      if (selection === localSelectionRef.current) setMessage({ tone: "error", text: error instanceof Error ? error.message : c("固件文件无效", "Invalid firmware file") });
    } finally {
      if (selection === localSelectionRef.current) setLocalFileBusy(false);
    }
  }

  async function selectedFirmware() {
    if (localFirmware) return { record: localFirmware.record, bytes: localFirmware.bytes };
    const record = firmwares.find((item) => item.id === selectedId);
    if (!record) throw new Error(c("请先选择 USB 完整固件", "Choose a complete USB image first"));
    return { record, bytes: await loadFirmwareContent(record.id) };
  }

  async function flash() {
    if (!localFirmware && !firmwares.some((item) => item.id === selectedId)) { setMessage({ tone: "error", text: c("请先选择 USB 固件", "Choose USB firmware first") }); return; }
    if (!window.confirm(c("请关闭设备，按住顶部 G0，连接 USB 后松开 G0，再继续烧录。", "Turn the device off, hold G0, connect USB, then release G0 before continuing."))) return;
    setBusy(true); setMessage(null); setProgress(null);
    try {
      const selectedBaudRate = usbFlashBaudRate(Number(baudRate));
      const { record, bytes } = await selectedFirmware();
      onEvent("info", c(`开始 USB 烧录 · ${record.fileName}`, `USB flashing started · ${record.fileName}`), { fileName: record.fileName, fileSize: bytes.byteLength, baudRate: selectedBaudRate });
      const result = await flashFirmwareOverUsb(record, bytes, setProgress, selectedBaudRate);
      setMessage({ tone: "success", text: c(`USB 烧录完成 · ${result.chipName}`, `USB flashing complete · ${result.chipName}`) });
      onEvent("success", c(`USB 烧录完成 · ${record.fileName}`, `USB flashing complete · ${record.fileName}`), { fileName: record.fileName, chipName: result.chipName });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "NotFoundError";
      const text = cancelled ? c("未选择 USB 设备", "No USB device selected") : error instanceof Error ? error.message : c("USB 烧录失败", "USB flashing failed");
      setMessage({ tone: "error", text });
      if (!cancelled) onEvent("warning", text);
    } finally { setBusy(false); }
  }

  return <article className="workbench-card firmware-flash-widget">
    <div className="widget-heading"><div><Usb size={18} /><strong>{c("USB 烧录", "USB flashing")}</strong></div><span className={usbSupported ? "widget-state" : "widget-state offline"}><i />{usbSupported ? c("浏览器可用", "Browser ready") : c("浏览器不支持", "Unsupported browser")}</span></div>
    <p>{c("用于首次安装和恢复完整固件。可直接选择电脑上的文件，固件只在浏览器中校验，不会上传。", "Install or recover a complete firmware image. You can choose a file from this computer; it is checked only in the browser and is never uploaded.")}</p>
    <div className="firmware-flash-source">
      <label><span>{c("烧录固件", "Firmware")}</span><select value={selectedId} disabled={busy || localFileBusy || !firmwares.length} onChange={(event) => { localSelectionRef.current += 1; setLocalSourceActive(false); setLocalFileBusy(false); setSelectedId(event.target.value); setLocalFirmware(null); setMessage(null); }}><option value="" disabled>{c("选择 USB 完整固件", "Choose a complete USB image")}</option>{firmwares.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label>
      <span>{c("或", "or")}</span><input ref={inputRef} className="visually-hidden" type="file" accept=".bin,application/octet-stream" onChange={(event) => void chooseLocal(event)} />
      <button className="secondary-button" type="button" disabled={busy || localFileBusy} onClick={() => inputRef.current?.click()}>{localFileBusy ? <Loader2 className="spinning" size={15} /> : <Upload size={15} />}{localFileBusy ? c("正在校验", "Checking file") : localFirmware?.record.fileName ?? c("选择本机完整固件", "Choose local complete image")}</button>
    </div>
    <label className="usb-flash-baud"><span>{c("刷写波特率", "Flashing baud rate")}</span><input type="number" inputMode="numeric" min="9600" max="2000000" step="1" list="usb-flash-baud-options" value={baudRate} disabled={busy} aria-invalid={!baudRateValid} onChange={(event) => setBaudRate(event.target.value)} /><datalist id="usb-flash-baud-options"><option value="115200" /><option value="460800" /><option value="921600" /></datalist><small>{c("连接不稳定时可降低波特率", "Lower the baud rate if the connection is unstable")}</small></label>
    <div className="flash-preflight"><span className={usbSupported ? "ready" : "blocked"}>{usbSupported ? <Check size={14} /> : <CircleAlert size={14} />}{c("USB 串口", "USB serial")}</span><span className={hasSelectedFirmware ? "ready" : "blocked"}>{hasSelectedFirmware ? <Check size={14} /> : <CircleAlert size={14} />}{c("兼容固件", "Compatible firmware")}</span></div>
    {progress ? <div className="flash-progress" aria-live="polite"><div><span>{progress.detail}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
    {message ? <div className={`flash-result ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{message.text}</span></div> : null}
    <button className="primary-button" type="button" disabled={busy || localFileBusy || !usbSupported || !baudRateValid || !hasSelectedFirmware} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <Usb size={17} />}{busy ? c("正在烧录", "Flashing") : c("连接 USB 并烧录", "Connect USB & flash")}</button>
  </article>;
}

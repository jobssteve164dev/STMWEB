import { Check, CircleAlert, FileCode2, Loader2, Radio, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { loadFirmwareContent, type DebugEventRecord, type FirmwareVersionRecord } from "./db.js";
import { flashDotApplication, validateDotApplication, type DotApplicationFirmware, type DotFlashProgress } from "./dot-firmware-flasher.js";
import { loadBuiltInDotArtifacts } from "./firmware-manifest.js";
import type { HardwareConnection } from "./hardware.js";
import { useLocale } from "./i18n.js";

interface DotFirmwareFlashPanelProps {
  connection: HardwareConnection | null;
  voltage: number;
  firmwareVersions: FirmwareVersionRecord[];
  onEvent: (level: DebugEventRecord["level"], message: string, payload?: DebugEventRecord["payload"]) => void;
}

interface SelectedFirmware { name: string; bytes: DotApplicationFirmware }

const builtInFirmwareId = "built-in-dot-stable";

const stageLabels: Record<DotFlashProgress["stage"], [string, string]> = {
  entering: ["正在进入升级模式", "Entering update mode"],
  checking: ["正在核对设备", "Checking device"],
  erasing: ["正在准备 Flash", "Preparing flash"],
  writing: ["正在写入固件", "Writing firmware"],
  verifying: ["正在校验固件", "Verifying firmware"],
  restarting: ["正在重启设备", "Restarting device"],
};

export function DotFirmwareFlashPanel({ connection, voltage, firmwareVersions, onEvent }: DotFirmwareFlashPanelProps) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const savedBins = useMemo(() => firmwareVersions.filter((item) => item.hardwareProfileId === "stmweb.dot-v1"
    && item.artifactRole === "application" && item.flashMethods.includes("bluetooth")
    && (item.status === "verified" || item.status === "stable")), [firmwareVersions]);
  const [savedId, setSavedId] = useState(builtInFirmwareId);
  const [localFirmware, setLocalFirmware] = useState<SelectedFirmware | null>(null);
  const [progress, setProgress] = useState<DotFlashProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bluetoothReady = connection?.kind === "bluetooth" && Boolean(connection.write && connection.setDataHandler);
  const voltageReady = voltage >= 3.3;

  useEffect(() => {
    if (!localFirmware && savedId !== builtInFirmwareId && !savedBins.some((item) => item.id === savedId)) setSavedId(builtInFirmwareId);
  }, [localFirmware, savedBins, savedId]);

  async function selectLocal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const firmware = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
      validateDotApplication(firmware.bytes);
      setLocalFirmware(firmware); setSavedId(""); setMessage(null);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : c("固件文件无效", "Invalid firmware file") });
    }
  }

  async function selectedFirmware(): Promise<SelectedFirmware> {
    if (localFirmware) return localFirmware;
    if (savedId === builtInFirmwareId) {
      const firmwarePackage = await loadBuiltInDotArtifacts("application", "bluetooth");
      const bytes = firmwarePackage.artifacts.map((artifact) => artifact.bytes);
      bytes.forEach(validateDotApplication);
      return { name: c(`${firmwarePackage.label}（自动匹配）`, `${firmwarePackage.label} (automatic match)`), bytes };
    }
    const saved = savedBins.find((item) => item.id === savedId);
    if (!saved) throw new Error(c("请先选择应用固件", "Choose an application firmware first"));
    const bytes = await loadFirmwareContent(saved.id);
    validateDotApplication(bytes);
    return { name: saved.fileName, bytes };
  }

  async function flash() {
    if (!bluetoothReady) { setMessage({ tone: "error", text: c("请先通过蓝牙连接 DOT 小车", "Connect the DOT vehicle over Bluetooth first") }); return; }
    if (!voltageReady) { setMessage({ tone: "error", text: c("电池电压未达到 3.30 V，暂不能开始烧录", "Battery voltage must reach 3.30 V before flashing") }); return; }
    if (!window.confirm(c("烧录期间小车会停止运行并重启。请保持供电和蓝牙连接，确定继续吗？", "The vehicle will stop and restart during flashing. Keep power and Bluetooth connected. Continue?"))) return;
    setBusy(true); setMessage(null); setProgress(null);
    try {
      const firmware = await selectedFirmware();
      const fileSize = firmware.bytes instanceof Uint8Array ? firmware.bytes.byteLength : firmware.bytes.reduce((total, item) => total + item.byteLength, 0);
      onEvent("info", c(`开始蓝牙烧录 · ${firmware.name}`, `Bluetooth flashing started · ${firmware.name}`), { fileName: firmware.name, fileSize });
      const result = await flashDotApplication(connection!, firmware.bytes, setProgress);
      if (result.restartConfirmed) {
        setMessage({ tone: "success", text: c("固件已校验写入，设备已重启并恢复数据", "Firmware verified, device restarted and data resumed") });
        onEvent("success", c(`蓝牙烧录完成 · ${firmware.name}`, `Bluetooth flashing completed · ${firmware.name}`), { crc32: result.firmwareCrc32, restartConfirmed: true });
      } else {
        setMessage({ tone: "warning", text: c("固件已校验写入，但尚未收到重启后的数据；请重新连接确认", "Firmware was verified, but no data arrived after restart. Reconnect to confirm") });
        onEvent("warning", c(`固件写入完成，等待重连确认 · ${firmware.name}`, `Firmware written; reconnect to confirm · ${firmware.name}`), { crc32: result.firmwareCrc32, restartConfirmed: false });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : c("蓝牙烧录失败", "Bluetooth flashing failed");
      setMessage({ tone: "error", text });
      onEvent("warning", c(`蓝牙烧录未完成 · ${text}`, `Bluetooth flashing did not complete · ${text}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="workbench-card firmware-flash-widget">
      <div className="widget-heading"><div><Radio size={18} /><strong>{c("蓝牙烧录", "Bluetooth Flashing")}</strong></div><span className={bluetoothReady ? "widget-state" : "widget-state offline"}><i />{bluetoothReady ? c("小车已连接", "Vehicle connected") : c("等待蓝牙", "Waiting for Bluetooth")}</span></div>
      <p>{c("直接使用内置稳定版，系统会根据小车实际容量自动选择匹配固件。", "Use the built-in stable release directly. The matching firmware is selected automatically from the vehicle's actual capacity.")}</p>
      <div className="firmware-flash-source">
        <label><span>{c("升级固件", "Update firmware")}</span><select value={savedId} disabled={busy} onChange={(event) => { setSavedId(event.target.value); setLocalFirmware(null); }}><option value={builtInFirmwareId}>{c("DOT 应用稳定版（保留 Bootloader，自动匹配）", "DOT application stable firmware (keeps Bootloader, automatic match)")}</option>{savedBins.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label>
        <span>{c("或", "or")}</span>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".bin,application/octet-stream" onChange={(event) => void selectLocal(event)} />
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={15} />{localFirmware ? localFirmware.name : c("选择本机 BIN", "Choose local BIN")}</button>
      </div>
      <div className="flash-preflight"><span className={bluetoothReady ? "ready" : "blocked"}>{bluetoothReady ? <Check size={14} /> : <CircleAlert size={14} />}{c("蓝牙连接", "Bluetooth")}</span><span className={voltageReady ? "ready" : "blocked"}>{voltageReady ? <Check size={14} /> : <CircleAlert size={14} />}{voltage > 0 ? `${voltage.toFixed(2)} V` : c("等待电压", "Waiting for voltage")}</span></div>
      {progress ? <div className="flash-progress" aria-live="polite"><div><span>{c(...stageLabels[progress.stage])}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
      {message ? <div className={`flash-result ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{message.text}</span></div> : null}
      <button className="primary-button" type="button" disabled={busy || !bluetoothReady || !voltageReady} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <FileCode2 size={17} />}{busy ? c("正在烧录", "Flashing") : c("开始蓝牙烧录", "Flash over Bluetooth")}</button>
    </article>
  );
}

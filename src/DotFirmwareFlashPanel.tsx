import { Check, CircleAlert, FileCode2, Loader2, Radio, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { loadFirmwareContent, type DebugEventRecord, type FirmwareVersionRecord } from "./db.js";
import { flashCardputerAdvApplication, validateCardputerAdvApplication } from "./cardputer-adv-flasher.js";
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

interface SelectedFirmware { name: string; bytes: DotApplicationFirmware | Uint8Array; hardwareProfileId: string }

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
  const savedBins = useMemo(() => firmwareVersions.filter((item) => item.artifactRole === "application" && item.flashMethods.includes("bluetooth")
    && (item.status === "verified" || item.status === "stable")), [firmwareVersions]);
  const [savedId, setSavedId] = useState(builtInFirmwareId);
  const [localFirmware, setLocalFirmware] = useState<SelectedFirmware | null>(null);
  const [progress, setProgress] = useState<DotFlashProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bluetoothReady = connection?.kind === "bluetooth" && Boolean(connection.write && connection.setDataHandler);
  const selectedProfileId = localFirmware?.hardwareProfileId ?? (savedId === builtInFirmwareId ? "stmweb.dot-v1" : savedBins.find((item) => item.id === savedId)?.hardwareProfileId);
  const voltageReady = selectedProfileId !== "stmweb.dot-v1" || voltage >= 3.3;

  useEffect(() => {
    if (!localFirmware && savedId !== builtInFirmwareId && !savedBins.some((item) => item.id === savedId)) setSavedId(builtInFirmwareId);
  }, [localFirmware, savedBins, savedId]);

  async function selectLocal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let hardwareProfileId = "stmweb.dot-v1";
      try { validateCardputerAdvApplication(bytes); hardwareProfileId = "stmweb.cardputer-adv"; }
      catch { validateDotApplication(bytes); }
      setLocalFirmware({ name: file.name, bytes, hardwareProfileId }); setSavedId(""); setMessage(null);
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
      return { name: c(`${firmwarePackage.label}（自动匹配）`, `${firmwarePackage.label} (automatic match)`), bytes, hardwareProfileId: "stmweb.dot-v1" };
    }
    const saved = savedBins.find((item) => item.id === savedId);
    if (!saved) throw new Error(c("请先选择应用固件", "Choose an application firmware first"));
    const bytes = await loadFirmwareContent(saved.id);
    if (saved.hardwareProfileId === "stmweb.cardputer-adv") validateCardputerAdvApplication(bytes);
    else validateDotApplication(bytes);
    return { name: saved.fileName, bytes, hardwareProfileId: saved.hardwareProfileId ?? "" };
  }

  async function flash() {
    if (!bluetoothReady) { setMessage({ tone: "error", text: c("请先通过蓝牙连接要升级的设备", "Connect the device to update over Bluetooth first") }); return; }
    setBusy(true); setMessage(null); setProgress(null);
    try {
      const firmware = await selectedFirmware();
      if (firmware.hardwareProfileId === "stmweb.dot-v1" && voltage < 3.3) throw new Error(c("电池电压未达到 3.30 V，暂不能开始烧录", "Battery voltage must reach 3.30 V before flashing"));
      const confirmed = firmware.hardwareProfileId === "stmweb.cardputer-adv"
        ? window.confirm(c("先短按 Cardputer ADV 顶部的 G0 键授权本次升级，再点“确定”。升级期间请保持设备供电并靠近电脑。", "Briefly press G0 on top of the Cardputer ADV to authorize this update, then choose OK. Keep the device powered and nearby."))
        : window.confirm(c("烧录期间设备会停止运行并重启。请保持供电和蓝牙连接，确定继续吗？", "The device will stop and restart during flashing. Keep power and Bluetooth connected. Continue?"));
      if (!confirmed) return;
      const fileSize = firmware.bytes instanceof Uint8Array ? firmware.bytes.byteLength : firmware.bytes.reduce((total, item) => total + item.byteLength, 0);
      onEvent("info", c(`开始蓝牙烧录 · ${firmware.name}`, `Bluetooth flashing started · ${firmware.name}`), { fileName: firmware.name, fileSize });
      if (firmware.hardwareProfileId === "stmweb.cardputer-adv") {
        const result = await flashCardputerAdvApplication(connection!, firmware.bytes as Uint8Array, setProgress);
        setMessage(result.restartScheduled
          ? { tone: "success", text: c("固件已校验写入，Cardputer ADV 正在重启", "Firmware verified; the Cardputer ADV is restarting") }
          : { tone: "warning", text: c("固件已写入，但尚未收到重启确认；请重新连接核对版本", "Firmware was written, but restart was not confirmed. Reconnect to verify the version") });
        onEvent(result.restartScheduled ? "success" : "warning", c(`Cardputer ADV 蓝牙升级写入完成 · ${firmware.name}`, `Cardputer ADV Bluetooth update written · ${firmware.name}`), { sha256: result.sha256, restartScheduled: result.restartScheduled });
        return;
      }
      const result = await flashDotApplication(connection!, firmware.bytes as DotApplicationFirmware, setProgress);
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
    <article className="workbench-card firmware-flash-widget bluetooth-flash-widget">
      <div className="widget-heading"><div><Radio size={18} /><strong>{c("蓝牙烧录", "Bluetooth Flashing")}</strong></div><span className={bluetoothReady ? "widget-state" : "widget-state offline"}><i />{bluetoothReady ? c("设备已连接", "Device connected") : c("等待蓝牙", "Waiting for Bluetooth")}</span></div>
      <p>{c("选择要通过蓝牙安装的应用固件。烧录期间请保持设备供电并靠近电脑。", "Choose the application to install over Bluetooth. Keep the device powered and near the computer while flashing.")}</p>
      <div className="firmware-flash-source">
        <label><span>{c("升级固件", "Update firmware")}</span><select value={savedId} disabled={busy} onChange={(event) => { setSavedId(event.target.value); setLocalFirmware(null); }}><option value={builtInFirmwareId}>{c("DOT 应用稳定版（保留 Bootloader，自动匹配）", "DOT application stable firmware (keeps Bootloader, automatic match)")}</option>{savedBins.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label>
        <span>{c("或", "or")}</span>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".bin,application/octet-stream" onChange={(event) => void selectLocal(event)} />
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={15} />{localFirmware ? localFirmware.name : c("选择本机 BIN", "Choose local BIN")}</button>
      </div>
      <div className="flash-preflight"><span className={bluetoothReady ? "ready" : "blocked"}>{bluetoothReady ? <Check size={14} /> : <CircleAlert size={14} />}{c("蓝牙连接", "Bluetooth")}</span>{selectedProfileId === "stmweb.dot-v1" ? <span className={voltageReady ? "ready" : "blocked"}>{voltageReady ? <Check size={14} /> : <CircleAlert size={14} />}{voltage > 0 ? `${voltage.toFixed(2)} V` : c("等待电压", "Waiting for voltage")}</span> : <span className={savedBins.length || localFirmware ? "ready" : "blocked"}>{savedBins.length || localFirmware ? <Check size={14} /> : <CircleAlert size={14} />}{c("兼容固件", "Compatible firmware")}</span>}</div>
      {progress ? <div className="flash-progress" aria-live="polite"><div><span>{c(...stageLabels[progress.stage])}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
      {message ? <div className={`flash-result ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{message.text}</span></div> : null}
      <button className="primary-button" type="button" disabled={busy || !bluetoothReady || !voltageReady} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <FileCode2 size={17} />}{busy ? c("正在烧录", "Flashing") : c("开始蓝牙烧录", "Flash over Bluetooth")}</button>
    </article>
  );
}

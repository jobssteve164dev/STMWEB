import { Check, CircleAlert, FileCode2, Loader2, Radio, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { loadFirmwareContent, type DebugEventRecord, type FirmwareVersionRecord } from "./db.js";
import type { HardwareConnection } from "./hardware.js";
import { flashCardputerAdvApplication, validateCardputerAdvApplication, type CardputerAdvFlashProgress } from "./cardputer-adv-flasher.js";
import { useLocale } from "./i18n.js";

interface Props {
  connection: HardwareConnection | null;
  firmwareVersions: FirmwareVersionRecord[];
  onEvent: (level: DebugEventRecord["level"], message: string, payload?: DebugEventRecord["payload"]) => void;
}

export function CardputerAdvFirmwareFlashPanel({ connection, firmwareVersions, onEvent }: Props) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const applications = useMemo(() => firmwareVersions.filter((item) => item.hardwareProfileId === "stmweb.cardputer-adv"
    && item.artifactRole === "application" && item.flashMethods.includes("bluetooth")
    && (item.status === "verified" || item.status === "stable")), [firmwareVersions]);
  const [selectedId, setSelectedId] = useState(applications[0]?.id ?? "");
  const [localFirmware, setLocalFirmware] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [progress, setProgress] = useState<CardputerAdvFlashProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bluetoothReady = connection?.kind === "bluetooth" && Boolean(connection.write && connection.setDataHandler);

  useEffect(() => {
    if (!selectedId && !localFirmware && applications[0]) setSelectedId(applications[0].id);
  }, [applications, localFirmware, selectedId]);

  async function chooseLocal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      validateCardputerAdvApplication(bytes);
      setLocalFirmware({ name: file.name, bytes }); setSelectedId(""); setMessage(null);
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : c("固件文件无效", "Invalid firmware file") }); }
  }

  async function selectedFirmware() {
    if (localFirmware) return localFirmware;
    const saved = applications.find((item) => item.id === selectedId) ?? applications[0];
    if (!saved) throw new Error(c("请先选择 Cardputer ADV 应用固件", "Choose a Cardputer ADV application first"));
    const bytes = await loadFirmwareContent(saved.id);
    validateCardputerAdvApplication(bytes);
    return { name: saved.fileName, bytes };
  }

  async function flash() {
    if (!bluetoothReady) { setMessage({ tone: "error", text: c("请先通过蓝牙连接 Cardputer ADV", "Connect the Cardputer ADV over Bluetooth first") }); return; }
    if (!window.confirm(c("先短按 Cardputer ADV 顶部的 G0 键授权本次升级，再点“确定”。升级期间请保持设备供电并靠近电脑。", "Briefly press G0 on top of the Cardputer ADV to authorize this update, then choose OK. Keep the device powered and nearby."))) return;
    setBusy(true); setMessage(null); setProgress(null);
    try {
      const firmware = await selectedFirmware();
      onEvent("info", c(`开始 Cardputer ADV 蓝牙升级 · ${firmware.name}`, `Cardputer ADV Bluetooth update started · ${firmware.name}`), { fileName: firmware.name, fileSize: firmware.bytes.byteLength });
      const result = await flashCardputerAdvApplication(connection!, firmware.bytes, setProgress);
      if (result.restartScheduled) {
        setMessage({ tone: "success", text: c("固件已校验写入，Cardputer ADV 正在重启", "Firmware verified; the Cardputer ADV is restarting") });
        onEvent("success", c(`Cardputer ADV 无线升级写入完成 · ${firmware.name}`, `Cardputer ADV wireless update written · ${firmware.name}`), { sha256: result.sha256, restartScheduled: true });
      } else {
        setMessage({ tone: "warning", text: c("固件已写入，但尚未收到重启确认；请重新连接核对版本", "Firmware was written, but restart was not confirmed. Reconnect to verify the version") });
        onEvent("warning", c("Cardputer ADV 已写入，等待重连确认", "Cardputer ADV written; reconnect to confirm"), { sha256: result.sha256, restartScheduled: false });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : c("无线升级失败", "Wireless update failed");
      setMessage({ tone: "error", text }); onEvent("warning", text);
    } finally { setBusy(false); }
  }

  return <article className="workbench-card firmware-flash-widget">
    <div className="widget-heading"><div><Radio size={18} /><strong>{c("Cardputer ADV 无线升级", "Cardputer ADV Wireless Update")}</strong></div><span className={bluetoothReady ? "widget-state" : "widget-state offline"}><i />{bluetoothReady ? c("设备已连接", "Device connected") : c("等待蓝牙", "Waiting for Bluetooth")}</span></div>
    <p>{c("选择已验证的应用固件，开始时短按设备顶部 G0 授权；当前固件会保留到新版本校验完成。", "Choose a verified application and briefly press G0 on the device when starting. The current firmware remains until the new version is validated.")}</p>
    <div className="firmware-flash-source">
      <label><span>{c("升级固件", "Update firmware")}</span><select value={selectedId} disabled={busy || Boolean(localFirmware)} onChange={(event) => { setSelectedId(event.target.value); setLocalFirmware(null); }}><option value="" disabled>{c("选择 Cardputer ADV 应用固件", "Choose a Cardputer ADV application")}</option>{applications.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}</select></label>
      <span>{c("或", "or")}</span><input ref={inputRef} className="visually-hidden" type="file" accept=".bin,application/octet-stream" onChange={(event) => void chooseLocal(event)} />
      <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={15} />{localFirmware?.name ?? c("选择本机 BIN", "Choose local BIN")}</button>
    </div>
    <div className="flash-preflight"><span className={bluetoothReady ? "ready" : "blocked"}>{bluetoothReady ? <Check size={14} /> : <CircleAlert size={14} />}{c("蓝牙连接", "Bluetooth")}</span><span className={applications.length || localFirmware ? "ready" : "blocked"}>{applications.length || localFirmware ? <Check size={14} /> : <CircleAlert size={14} />}{c("Cardputer ADV 应用固件", "Cardputer ADV application")}</span></div>
    {progress ? <div className="flash-progress" aria-live="polite"><div><span>{progress.stage === "checking" ? c("正在核对设备", "Checking device") : progress.stage === "writing" ? c("正在写入固件", "Writing firmware") : progress.stage === "verifying" ? c("正在校验固件", "Verifying firmware") : c("正在重启设备", "Restarting device")}</span><strong>{progress.percent}%</strong></div><progress max="100" value={progress.percent} /></div> : null}
    {message ? <div className={`flash-result ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{message.text}</span></div> : null}
    <button className="primary-button" type="button" disabled={busy || !bluetoothReady || (!applications.length && !localFirmware)} onClick={() => void flash()}>{busy ? <Loader2 className="spinning" size={17} /> : <FileCode2 size={17} />}{busy ? c("正在升级", "Updating") : c("开始蓝牙升级", "Update over Bluetooth")}</button>
  </article>;
}

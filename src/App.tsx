import {
  Activity,
  Bluetooth,
  Box,
  Cable,
  Check,
  CircleAlert,
  CircleDot,
  Cpu,
  Database,
  Download,
  FileCode2,
  Gauge,
  HardDrive,
  History,
  LayoutDashboard,
  ListRestart,
  Loader2,
  LogOut,
  MemoryStick,
  BadgeDollarSign,
  Play,
  Plug,
  Radio,
  RadioTower,
  RefreshCw,
  Settings,
  ShieldCheck,
  Square,
  SquareTerminal,
  Upload,
  Usb,
  Wifi,
  X,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  listEvents,
  listDevices,
  createDevice,
  listFirmwareVersions,
  listSessions,
  saveEvent,
  saveFirmwareVersion,
  saveSession,
  loadWorkbenchPreference,
  saveWorkbenchPreference,
  type DebugEventRecord,
  type DebugSessionRecord,
  type FirmwareVersionRecord,
  type DeviceRecord,
} from "./db.js";
import {
  inspectHardwareCapabilities,
  requestHardwareConnection,
  type SerialConnectionOptions,
  type HardwareCapability,
  type HardwareCapabilityId,
  type HardwareConnection,
} from "./hardware.js";
import { DeviceWorkbench, type TelemetrySnapshot } from "./DeviceWorkbench.js";
import {
  demoCapabilityManifest,
  parseCapabilityManifest,
  recommendedComponents,
  type DeviceCapabilityManifest,
  type DeviceCapabilityType,
} from "./device-capabilities.js";
import { dotCapabilityManifest, parseDotTelemetryChunk } from "./dot-telemetry.js";
import { ApiConnectionsSettings } from "./ApiConnectionsSettings.js";
import { DotFirmwareFlashPanel } from "./DotFirmwareFlashPanel.js";
import { SwdFlashPanel } from "./InitialSwdFlashPanel.js";
import { BuildRunnerPanel } from "./BuildRunnerPanel.js";
import { useLocale } from "./i18n.js";
import { HardwareGatewayPanel } from "./HardwareGatewayPanel.js";

type ViewId = "console" | "devices" | "gateway" | "firmware" | "sessions" | "settings";

interface ConnectionInfo {
  name: string;
  detail: string;
  kind: HardwareCapabilityId | "demo";
  isDemo: boolean;
}

interface ToastState {
  tone: "success" | "warning" | "info";
  message: string;
}

interface MetricCardProps {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
}

interface AppProps {
  workspace: { id: string; name: string; slug: string; role: string };
  user: { id: string; username: string; name: string; email?: string };
  planAccess: { tier: "free" | "pro"; pro: boolean; status: "ready" | "unavailable" };
  onSignOut: () => void;
}

const navigation: Array<{ id: ViewId; zh: string; en: string; icon: LucideIcon }> = [
  { id: "console", zh: "调试台", en: "Workbench", icon: LayoutDashboard },
  { id: "devices", zh: "设备台账", en: "Devices", icon: Cpu },
  { id: "gateway", zh: "硬件网关", en: "Gateway", icon: RadioTower },
  { id: "firmware", zh: "固件管理", en: "Firmware Management", icon: Box },
  { id: "sessions", zh: "会话记录", en: "Sessions", icon: History },
  { id: "settings", zh: "设置", en: "Settings", icon: Settings },
];

const emptyDevice: DeviceRecord = {
  id: "unregistered",
  workspaceId: "",
  name: "未登记设备",
  model: "待填写",
  board: "待填写",
  clock: "—",
  flash: "—",
  location: "未指定位置",
  version: "未关联",
  note: "",
};

const exampleFirmware: FirmwareVersionRecord & { isExample: true } = {
  id: "example-v084",
  fileName: "env-node-v0.8.4.elf",
  fileSize: 726_304,
  fileType: "ELF",
  sha256: "4f390d4c1b83a2f7",
  hardwareProfileId: null,
  artifactRole: "unclassified",
  flashMethods: [],
  flashSize: null,
  applicationBase: null,
  applicationLimit: null,
  runtimeVersion: null,
  status: "draft",
  createdAt: "2026-08-12T09:40:00.000Z",
  isExample: true,
};

const capabilityIcons: Record<HardwareCapabilityId, LucideIcon> = {
  serial: Cable,
  usb: Usb,
  hid: Radio,
  bluetooth: Bluetooth,
  network: Wifi,
};

const commonBaudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const emptyTelemetrySnapshot: TelemetrySnapshot = {
  pitch: 0,
  roll: 0,
  gyro: 0,
  leftSpeed: 0,
  rightSpeed: 0,
  leftPwm: 0,
  rightPwm: 0,
  voltage: 0,
  lineOffset: 0,
  lineAngle: 0,
  balanceKp: 0,
  balanceKi: 0,
  balanceKd: 0,
  velocityKp: 0,
  velocityKi: 0,
  velocityKd: 0,
  averagePwm: 0,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MetricCard({ label, value, note, icon: Icon }: MetricCardProps) {
  return (
    <article className="metric-card">
      <span className="metric-icon" aria-hidden="true">
        <Icon size={19} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon, title, body, action }: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true"><Icon size={25} /></span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function App({ workspace, user, planAccess, onSignOut }: AppProps) {
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const sessionDateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }), [locale]);
  const [activeView, setActiveView] = useState<ViewId>("console");
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<HardwareCapability[]>([]);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<HardwareCapabilityId | null>(null);
  const [networkUrl, setNetworkUrl] = useState("http://192.168.1.50/health");
  const [serialBaudRate, setSerialBaudRate] = useState("115200");
  const [customBaudRate, setCustomBaudRate] = useState("115200");
  const [serialDataBits, setSerialDataBits] = useState<SerialConnectionOptions["dataBits"]>(8);
  const [serialStopBits, setSerialStopBits] = useState<SerialConnectionOptions["stopBits"]>(1);
  const [serialParity, setSerialParity] = useState<SerialConnectionOptions["parity"]>("none");
  const [serialFlowControl, setSerialFlowControl] = useState<SerialConnectionOptions["flowControl"]>("none");
  const [connecting, setConnecting] = useState<HardwareCapabilityId | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [currentSession, setCurrentSession] = useState<DebugSessionRecord | null>(null);
  const [sessions, setSessions] = useState<DebugSessionRecord[]>([]);
  const [firmwareVersions, setFirmwareVersions] = useState<FirmwareVersionRecord[]>([]);
  const [logs, setLogs] = useState<DebugEventRecord[]>([]);
  const [telemetry, setTelemetry] = useState<number[]>([]);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot>(emptyTelemetrySnapshot);
  const [deviceManifest, setDeviceManifest] = useState<DeviceCapabilityManifest | null>(null);
  const [selectedComponents, setSelectedComponents] = useState<DeviceCapabilityType[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [fileBusy, setFileBusy] = useState(false);

  const connectionRef = useRef<HardwareConnection | null>(null);
  const currentSessionRef = useRef<DebugSessionRecord | null>(null);
  const sequenceRef = useRef(0);
  const demoIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const dotTelemetryCarryRef = useRef("");

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? {
    ...emptyDevice,
    name: c("未登记设备", "Unregistered device"),
    model: c("待填写", "Not provided"),
    board: c("待填写", "Not provided"),
    location: c("未指定位置", "Location not specified"),
    version: c("未关联", "Not linked"),
  };
  const activeCapability = capabilities.find((item) => item.id === selectedCapability);

  const combinedFirmware = useMemo(
    () => [
      ...firmwareVersions.map((version) => ({
        ...version,
        isExample: false,
        fileType: version.fileType || version.fileName.split(".").pop()?.toUpperCase() || "FILE",
      })),
      exampleFirmware,
    ],
    [firmwareVersions],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      inspectHardwareCapabilities(),
      listDevices(),
      listSessions(),
      listFirmwareVersions(),
    ])
      .then(([hardwareCapabilities, savedDevices, savedSessions, savedVersions]) => {
        if (!active) return;
        setCapabilities(hardwareCapabilities);
        setDevices(savedDevices);
        setSelectedDeviceId((current) => current || savedDevices[0]?.id || "");
        setSessions(savedSessions);
        setFirmwareVersions(savedVersions);
      })
      .catch(() => {
        if (!active) return;
        setStorageHealthy(false);
        setToast({ tone: "warning", message: c("工作区数据暂时无法加载，请检查网络后重试", "Workspace data could not be loaded. Check your connection and try again.") });
      });

    return () => {
      active = false;
    };
  }, [workspace.id]);

  useEffect(() => {
    const refreshFirmware = () => void listFirmwareVersions().then(setFirmwareVersions).catch(handleStorageError);
    window.addEventListener("stmweb:firmware-updated", refreshFirmware);
    return () => window.removeEventListener("stmweb:firmware-updated", refreshFirmware);
  }, [workspace.id]);

  useEffect(() => {
    if (!deviceManifest) return;
    let active = true;
    void loadWorkbenchPreference(deviceManifest.device.id)
      .then((saved) => {
        if (!active) return;
        setSelectedComponents(saved ?? recommendedComponents(deviceManifest));
      })
      .catch(() => {
        if (active) setSelectedComponents(recommendedComponents(deviceManifest));
      });
    return () => { active = false; };
  }, [deviceManifest, workspace.id]);

  function updateSelectedComponents(selected: DeviceCapabilityType[]) {
    setSelectedComponents(selected);
    if (!deviceManifest) return;
    void saveWorkbenchPreference(deviceManifest.device.id, selected).catch(handleStorageError);
  }

  async function submitDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeviceBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const device = await createDevice({
        name: String(form.get("name") || ""),
        model: String(form.get("model") || ""),
        board: String(form.get("board") || ""),
        clock: String(form.get("clock") || ""),
        flash: String(form.get("flash") || ""),
        location: String(form.get("location") || ""),
        version: String(form.get("version") || ""),
        note: String(form.get("note") || ""),
      });
      setDevices((current) => [device, ...current]);
      setSelectedDeviceId(device.id);
      setDeviceDialogOpen(false);
      setToast({ tone: "success", message: c(`${device.name} 已加入设备台账`, `${device.name} was added to the device registry`) });
    } catch (reason) {
      setToast({ tone: "warning", message: reason instanceof Error ? reason.message : c("设备保存失败", "The device could not be saved") });
    } finally {
      setDeviceBusy(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!connectionDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !connecting) setConnectionDialogOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [connectionDialogOpen, connecting]);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
  }, [logs]);

  useEffect(() => () => {
    if (demoIntervalRef.current !== null) window.clearInterval(demoIntervalRef.current);
    void connectionRef.current?.close();
    const session = currentSessionRef.current;
    if (session) {
      void saveSession({
        ...session,
        endedAt: new Date().toISOString(),
        status: "interrupted",
      }).catch(() => undefined);
    }
  }, []);

  function handleStorageError() {
    setStorageHealthy(false);
    setToast({ tone: "warning", message: c("调试记录尚未保存，请检查网络后重试", "The debugging record has not been saved. Check your connection and try again.") });
  }

  function appendEvent(
    level: DebugEventRecord["level"],
    message: string,
    payload?: DebugEventRecord["payload"],
  ) {
    const session = currentSessionRef.current;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const event: DebugEventRecord = {
      id: crypto.randomUUID(),
      sessionId: session?.id ?? "unrecorded",
      sequence,
      recordedAt: new Date().toISOString(),
      level,
      message,
      payload,
    };

    setLogs((current) => [...current, event].slice(-160));
    if (!session) return;

    const updatedSession = { ...session, eventCount: sequence };
    currentSessionRef.current = updatedSession;
    setCurrentSession(updatedSession);
    void saveEvent(event).catch(handleStorageError);
    void saveSession(updatedSession).catch(handleStorageError);
  }

  function startSession(options: { isDemo?: boolean; label?: string } = {}) {
    if (currentSessionRef.current) return;
    const isDemo = options.isDemo ?? connectionInfo?.isDemo ?? false;
    const session: DebugSessionRecord = {
      id: crypto.randomUUID(),
      projectId: workspace.id,
      deviceName: selectedDevice.name,
      connectionLabel: options.label ?? connectionInfo?.name ?? c("浏览器设备", "Browser device"),
      startedAt: new Date().toISOString(),
      status: "recording",
      eventCount: 0,
      isDemo,
    };

    sequenceRef.current = 0;
    currentSessionRef.current = session;
    setCurrentSession(session);
    setLogs([]);
    setTelemetry([]);
    setTelemetrySnapshot(emptyTelemetrySnapshot);
    void saveSession(session).catch(handleStorageError);
    appendEvent("success", c(`会话已开始 · ${session.connectionLabel}`, `Session started · ${session.connectionLabel}`));

    if (isDemo) {
      let tick = 0;
      demoIntervalRef.current = window.setInterval(() => {
        tick += 1;
        const temperature = 24.1 + Math.sin(tick / 4) * 1.3 + Math.random() * 0.2;
        const voltage = 3.29 + Math.sin(tick / 7) * 0.025;
        const signal = -54 + Math.round(Math.sin(tick / 3) * 4);
        const pitch = Math.sin(tick / 3) * 8;
        const roll = Math.cos(tick / 5) * 4;
        const leftSpeed = 128 + Math.sin(tick / 2) * 24;
        const rightSpeed = 124 + Math.cos(tick / 2.4) * 21;
        setTelemetry((current) => [...current, temperature].slice(-48));
        setTelemetrySnapshot({
          pitch,
          roll,
          gyro: Math.cos(tick / 3) * 12,
          leftSpeed,
          rightSpeed,
          leftPwm: 42 + Math.sin(tick / 4) * 8,
          rightPwm: 40 + Math.cos(tick / 4) * 7,
          voltage,
          lineOffset: Math.sin(tick / 2.5) * 14,
          lineAngle: Math.cos(tick / 3.5) * 9,
          balanceKp: 120,
          balanceKi: 0,
          balanceKd: 0.3,
          velocityKp: 120,
          velocityKi: 0.6,
          velocityKd: 0,
          averagePwm: (leftSpeed + rightSpeed) / 2,
        });
        appendEvent("data", `TEMP=${temperature.toFixed(2)}°C  VBUS=${voltage.toFixed(3)}V  RSSI=${signal}dBm`, {
          temperature: Number(temperature.toFixed(2)),
          voltage: Number(voltage.toFixed(3)),
          signal,
        });
        if (tick % 7 === 0) appendEvent("info", c("传感器采样周期稳定 · 1000 ms", "Sensor sampling interval stable · 1000 ms"));
      }, 900);
    }

    setToast({ tone: "success", message: isDemo ? c("演示会话正在记录", "Demo session is recording") : c("调试会话正在记录", "Debugging session is recording") });
  }

  async function stopSession() {
    if (demoIntervalRef.current !== null) {
      window.clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    if (!currentSessionRef.current) return;
    appendEvent("info", c("记录已停止，数据已写入工作区台账", "Recording stopped and data was written to the workspace ledger"));
    const completed: DebugSessionRecord = {
      ...currentSessionRef.current,
      endedAt: new Date().toISOString(),
      status: "completed",
    };
    currentSessionRef.current = null;
    setCurrentSession(null);
    setSessions((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
    await saveSession(completed).catch(handleStorageError);
    setToast({ tone: "success", message: c(`已保存 ${completed.eventCount} 条调试记录`, `${completed.eventCount} debugging records saved`) });
  }

  function beginDemoSession() {
    if (!connectionInfo) {
      setConnectionInfo({
        name: c("演示设备", "Demo device"),
        detail: c("生成可识别的模拟遥测，不会操作真实硬件", "Generates identifiable simulated telemetry without operating real hardware"),
        kind: "demo",
        isDemo: true,
      });
    }
    setDeviceManifest(demoCapabilityManifest);
    startSession({ isDemo: true, label: c("演示设备", "Demo device") });
  }

  async function connectHardware(kind: HardwareCapabilityId) {
    setConnecting(kind);
    try {
      const baudRate = Number(serialBaudRate === "custom" ? customBaudRate : serialBaudRate);
      if (kind === "serial" && (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 4_000_000)) {
        throw new Error(c("波特率请输入 300 到 4000000 之间的整数", "Enter an integer baud rate between 300 and 4,000,000"));
      }
      const connection = await requestHardwareConnection(kind, {
        networkUrl,
        serial: {
          baudRate,
          dataBits: serialDataBits,
          stopBits: serialStopBits,
          parity: serialParity,
          flowControl: serialFlowControl,
        },
        onSerialText: (text) => {
          const manifest = parseCapabilityManifest(text);
          if (manifest) {
            setDeviceManifest(manifest);
            appendEvent("success", c(`已识别 ${manifest.capabilities.length} 项设备能力`, `${manifest.capabilities.length} device capabilities detected`), {
              model: manifest.device.model,
              firmwareVersion: manifest.device.firmwareVersion,
            });
            return;
          }
          const dotTelemetry = parseDotTelemetryChunk(dotTelemetryCarryRef.current, text);
          dotTelemetryCarryRef.current = dotTelemetry.carry;
          if (dotTelemetry.measurements.length > 0) {
            setDeviceManifest((current) => current ?? dotCapabilityManifest);
            setTelemetrySnapshot((current) => {
              const next = { ...current };
              for (const measurement of dotTelemetry.measurements) next[measurement.channel] = measurement.value;
              return next;
            });
          }
          appendEvent("data", text.trim() || c("收到串口数据", "Serial data received"));
        },
      });
      connectionRef.current = connection;
      setConnectionInfo({
        name: connection.name,
        detail: connection.detail,
        kind: connection.kind,
        isDemo: false,
      });
      if (kind !== "serial" && kind !== "bluetooth") setDeviceManifest(null);
      setConnectionDialogOpen(false);
      setSelectedCapability(null);
      setToast({ tone: "success", message: c(`${connection.name} 已连接`, `${connection.name} connected`) });
    } catch (error) {
      setToast({
        tone: "warning",
        message: error instanceof Error ? error.message : c("设备连接失败，请重试", "The device could not connect. Try again."),
      });
    } finally {
      setConnecting(null);
    }
  }

  async function disconnectHardware() {
    if (currentSessionRef.current) await stopSession();
    await connectionRef.current?.close().catch(() => undefined);
    connectionRef.current = null;
    setConnectionInfo(null);
    setDeviceManifest(null);
    setSelectedComponents([]);
    setTelemetry([]);
    dotTelemetryCarryRef.current = "";
    setLogs([]);
    setToast({ tone: "info", message: c("设备连接已断开", "Device disconnected") });
  }

  async function importFirmware(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileBusy(true);
    try {
      const savedVersion = await saveFirmwareVersion(file);
      setFirmwareVersions((current) => [savedVersion, ...current.filter((item) => item.id !== savedVersion.id)]);
      setToast(savedVersion.status === "verified" || savedVersion.status === "stable"
        ? { tone: "success", message: c(`${file.name} 已识别并保存，可用于匹配的烧录方式`, `${file.name} was identified and is ready for compatible flashing`) }
        : { tone: "info", message: c(`${file.name} 已保存为待适配制品，不会用于烧录`, `${file.name} was saved for adaptation and will not be offered for flashing`) });
    } catch (error) {
      setToast({ tone: "warning", message: error instanceof Error ? error.message : c("固件文件保存失败", "The firmware file could not be saved") });
    } finally {
      setFileBusy(false);
    }
  }

  async function exportSession(session: DebugSessionRecord) {
    try {
      const events = await listEvents(session.id);
      const payload = JSON.stringify({ session, events }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `stmweb-session-${session.id.slice(0, 8)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({ tone: "success", message: c("会话记录已导出", "Session history exported") });
    } catch {
      setToast({ tone: "warning", message: c("会话导出失败，请稍后重试", "The session could not be exported. Try again shortly.") });
    }
  }

  const currentTemperature = telemetry.at(-1);
  const storageLabel = storageHealthy ? c("工作区数据库", "Workspace database") : c("暂不可用", "Unavailable");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{c("跳到主要内容", "Skip to main content")}</a>

      <aside className="sidebar" aria-label={c("主导航", "Primary navigation")}>
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true"><Activity size={22} /></span>
          <div>
            <strong>STMWEB</strong>
            <span>{c("硬件调试工作台", "Hardware Debugging Workbench")}</span>
          </div>
        </div>

        <div className="workspace-select" aria-label={c("当前工作区", "Current workspace")}>
          <span className="workspace-avatar">H</span>
          <span><small>{c("当前工作区", "Current workspace")}</small><strong>{workspace.name}</strong></span>
        </div>

        <nav className="main-nav">
          <span className="nav-label">{c("工作区", "Workspace")}</span>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "nav-item active" : "nav-item"}
                type="button"
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{isEnglish ? item.en : item.zh}</span>
                {item.id === "sessions" && sessions.length > 0 ? <b>{sessions.length}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-devices">
          <div className="section-heading compact">
            <span>{c("最近设备", "Recent devices")}</span>
          </div>
          {devices.map((device) => (
            <button
              className={device.id === selectedDevice.id ? "device-mini selected" : "device-mini"}
              type="button"
              key={device.id}
              disabled={Boolean(connectionInfo) && device.id !== selectedDevice.id}
              onClick={() => {
                setSelectedDeviceId(device.id);
                setActiveView("console");
              }}
            >
              <span className="device-mini-icon" aria-hidden="true"><Cpu size={17} /></span>
              <span><strong>{device.name}</strong><small>{device.model}</small></span>
              {device.id === selectedDevice.id ? <CircleDot size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>

        <div className="storage-status">
          <ShieldCheck size={18} aria-hidden="true" />
          <div><strong>{storageHealthy ? c("自动记录已开启", "Automatic recording is on") : c("记录存储受限", "Record storage is limited")}</strong><span>{storageLabel}</span></div>
        </div>
        <a className="workbench-plan-link" href="/plans">
          <BadgeDollarSign size={18} aria-hidden="true" />
          <span><strong>{planAccess.pro ? c("Pro 计划", "Pro plan") : c("免费计划", "Free plan")}</strong><small>{planAccess.pro ? c("Runner 与 API 已解锁", "Runner & API unlocked") : c("查看 Pro 能力", "Explore Pro capabilities")}</small></span>
        </a>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{workspace.name}</span><span>/</span><strong>{activeView === "gateway" ? c("硬件网关", "Hardware Gateway") : selectedDevice.name}</strong>
          </div>
          <div className="topbar-status">
            <span className="environment-badge"><span />{c("数据已同步", "Data synced")}</span>
            <button className="account-button" type="button" onClick={onSignOut} title={`${user.name} · ${c("退出登录", "Sign out")}`} aria-label={`${user.name} · ${c("退出登录", "Sign out")}`}>
              <span className="account-mark">{user.name.slice(0, 2).toUpperCase()}</span>
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          <div className="view-transition" key={activeView}>
          {activeView === "console" ? (
            <>
              <section className="device-hero" aria-labelledby="device-title">
                <div className="hero-device-icon" aria-hidden="true"><Cpu size={28} /></div>
                <div className="hero-copy">
                  <div className="eyebrow-row">
                    <span className={connectionInfo ? "state-pill online" : "state-pill"}>
                      <span />{connectionInfo ? c("已连接", "Connected") : c("等待连接", "Waiting to connect")}
                    </span>
                    <span>{selectedDevice.board}</span>
                  </div>
                  <h1 id="device-title">{selectedDevice.name}</h1>
                  <p>{connectionInfo ? `${connectionInfo.name} · ${connectionInfo.detail}` : `${selectedDevice.model} · ${selectedDevice.location}`}</p>
                </div>
                <div className="hero-actions">
                  {connectionInfo ? (
                    <>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => currentSession ? void stopSession() : startSession()}
                      >
                        {currentSession ? <><Square size={17} />{c("停止记录", "Stop Recording")}</> : <><CircleDot size={17} />{c("开始记录", "Start Recording")}</>}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void disconnectHardware()}>
                        {c("断开", "Disconnect")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="primary-button" type="button" onClick={() => setConnectionDialogOpen(true)}>
                        <Plug size={17} aria-hidden="true" />{c("连接设备", "Connect Device")}
                      </button>
                      <button className="secondary-button" type="button" onClick={beginDemoSession}>
                        <Play size={17} aria-hidden="true" />{c("试用演示", "Try Demo")}
                      </button>
                    </>
                  )}
                </div>
              </section>

              <section className="metrics-grid" aria-label={c("设备摘要", "Device summary")}>
                <MetricCard label={c("当前固件", "Current firmware")} value={selectedDevice.version || c("未关联", "Not linked")} note={c("设备台账", "Device registry")} icon={FileCode2} />
                <MetricCard label={c("已存会话", "Saved sessions")} value={String(sessions.length)} note={c("工作区数据库", "Workspace database")} icon={Database} />
                <MetricCard label={c("连接方式", "Connection")} value={connectionInfo ? connectionInfo.kind.toUpperCase() : "—"} note={connectionInfo ? connectionInfo.name : c("尚未选择", "Not selected")} icon={Cable} />
                <MetricCard label={c("实时温度", "Live temperature")} value={currentTemperature ? `${currentTemperature.toFixed(1)}°C` : "—"} note={currentSession?.isDemo ? c("演示遥测", "Demo telemetry") : c("等待数据", "Waiting for data")} icon={Gauge} />
              </section>

              {deviceManifest ? (
                <DeviceWorkbench
                  manifest={deviceManifest}
                  selected={selectedComponents}
                  telemetry={telemetrySnapshot}
                  isDemo={Boolean(connectionInfo?.isDemo)}
                  proAccess={planAccess.pro}
                  onOpenFirmware={() => setActiveView("firmware")}
                  onChange={updateSelectedComponents}
                />
              ) : connectionInfo ? (
                <section className="manifest-waiting" aria-live="polite">
                  <Loader2 className="spinning" size={22} />
                  <div><strong>{c("正在识别设备能力", "Detecting device capabilities")}</strong><span>{c("固件报告硬件状态后，可选择本次需要的调试组件。", "Choose the components you need once the firmware reports hardware status.")}</span></div>
                </section>
              ) : null}

              <section className="dashboard-grid support-dashboard-grid">

                <article className="panel terminal-panel">
                  <div className="panel-heading terminal-heading">
                    <div><span className="panel-kicker">{c("会话输出", "Session output")}</span><h2>{c("调试终端", "Debug terminal")}</h2></div>
                    <span>{c(`${logs.length} 条`, `${logs.length} entries`)}</span>
                  </div>
                  <div className="terminal" ref={terminalRef} role="log" aria-label={c("调试会话输出", "Debug session output")}>
                    {logs.length === 0 ? (
                      <div className="terminal-empty"><SquareTerminal size={22} /><span>{c("连接设备或启动演示后，输出会显示在这里。", "Output appears here after you connect a device or start the demo.")}</span></div>
                    ) : logs.map((log) => (
                      <div className={`log-line ${log.level}`} key={log.id}>
                        <time>{new Date(log.recordedAt).toLocaleTimeString(locale, { hour12: false })}</time>
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel capability-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">{c("浏览器环境", "Browser environment")}</span><h2>{c("本机连接能力", "Local connectivity")}</h2></div>
                    <button type="button" aria-label={c("重新检测", "Detect again")} onClick={() => void inspectHardwareCapabilities().then(setCapabilities)}>
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <div className="capability-list">
                    {capabilities.length === 0 ? (
                      <div className="capability-loading"><Loader2 size={18} />{c("正在检测浏览器能力", "Detecting browser capabilities…")}</div>
                    ) : capabilities.map((capability) => {
                      const Icon = capabilityIcons[capability.id];
                      return (
                        <div className="capability-row" key={capability.id}>
                          <span className="capability-icon"><Icon size={17} /></span>
                          <span><strong>{capability.label}</strong><small>{capability.permission}</small></span>
                          <span className={capability.supported ? "support-mark supported" : "support-mark"}>
                            {capability.supported ? <Check size={15} /> : <X size={15} />}
                            {capability.supported ? c("可用", "Available") : c("不可用", "Unavailable")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              </section>
            </>
          ) : null}

          {activeView === "devices" ? (
            <section className="page-section" aria-labelledby="devices-heading">
              <div className="page-heading"><div><span className="panel-kicker">{c("设备台账", "Device registry")}</span><h1 id="devices-heading">{c("实体设备", "Physical devices")}</h1><p>{c("每台硬件保留稳定身份、固件版本和调试历史。", "Keep a stable identity, firmware history and debugging record for every device.")}</p></div><button className="primary-button" type="button" onClick={() => setDeviceDialogOpen(true)}><Plus size={17} />{c("登记设备", "Register Device")}</button></div>
              {devices.length === 0 ? <EmptyState icon={Cpu} title={c("还没有设备", "No devices yet")} body={c("先登记一台 STM32 设备，再开始连接和记录调试数据。", "Register an STM32 device before connecting and recording debugging data.")} action={<button className="primary-button" type="button" onClick={() => setDeviceDialogOpen(true)}><Plus size={17} />{c("登记第一台设备", "Register First Device")}</button>} /> : <div className="table-panel">
                <table>
                  <thead><tr><th>{c("设备", "Device")}</th><th>{c("主控", "MCU")}</th><th>{c("板卡", "Board")}</th><th>{c("位置", "Location")}</th><th>{c("当前固件", "Firmware")}</th><th>{c("状态", "Status")}</th></tr></thead>
                  <tbody>{devices.map((device) => <tr key={device.id} onClick={() => setSelectedDeviceId(device.id)}><td><strong>{device.name}</strong><small>{device.note || "—"}</small></td><td>{device.model || "—"}</td><td>{device.board || "—"}</td><td>{device.location || "—"}</td><td><span className="version-chip">{device.version || c("未关联", "Not linked")}</span></td><td><span className={device.id === selectedDevice.id && connectionInfo ? "state-pill online" : "state-pill"}><span />{device.id === selectedDevice.id && connectionInfo ? c("已连接", "Connected") : c("离线", "Offline")}</span></td></tr>)}</tbody>
                </table>
              </div>}
            </section>
          ) : null}

          {activeView === "gateway" ? <HardwareGatewayPanel workspaceId={workspace.id} onOpenSettings={() => setActiveView("settings")} /> : null}

          {activeView === "firmware" ? (
            <section className="page-section" aria-labelledby="firmware-heading">
              <div className="page-heading"><div><span className="panel-kicker">{c("版本化管理", "Versioned management")}</span><h1 id="firmware-heading">{c("固件管理", "Firmware Management")}</h1><p>{c("安装、升级和管理工作区中的固件。", "Install, update and manage firmware in this workspace.")}</p></div><button className="primary-button" type="button" disabled={fileBusy} onClick={() => fileInputRef.current?.click()}>{fileBusy ? <Loader2 size={17} className="spinning" /> : <Upload size={17} />}{fileBusy ? c("正在校验", "Verifying…") : c("导入固件", "Import Firmware")}</button></div>
              <section className="firmware-actions" aria-labelledby="firmware-actions-heading">
                <div className="firmware-actions-heading">
                  <div><span className="panel-kicker">{c("常用工具", "Common tools")}</span><h2 id="firmware-actions-heading">{c("固件安装与升级", "Firmware installation & updates")}</h2></div>
                  <p>{c("SWD 可长期用于安装、更新和恢复；硬件支持无线时，也可以直接升级应用。", "Use SWD for installation, updates and recovery at any time. Compatible hardware can also update applications wirelessly.")}</p>
                </div>
                <div className="firmware-actions-grid">
                  <SwdFlashPanel firmwareVersions={firmwareVersions} />
                  <DotFirmwareFlashPanel connection={connectionRef.current} voltage={telemetrySnapshot.voltage} firmwareVersions={firmwareVersions} onEvent={appendEvent} />
                </div>
              </section>
              <BuildRunnerPanel proAccess={planAccess.pro} />
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".bin,.hex,.elf,.axf,.srec" onChange={(event) => void importFirmware(event)} />
              <section className="workbench-card firmware-library-card" aria-labelledby="firmware-library-heading">
                <div className="firmware-library-heading">
                  <div><span className="panel-kicker">{c("工作区固件", "Workspace firmware")}</span><h2 id="firmware-library-heading">{c("固件列表", "Firmware list")}</h2></div>
                  <span>{c(`${combinedFirmware.length} 个固件`, `${combinedFirmware.length} firmware files`)}</span>
                </div>
                <div className="artifact-grid">
                  {combinedFirmware.map((version) => (
                    <article className="artifact-card" key={version.id}>
                      <span className="artifact-icon"><FileCode2 size={21} /></span>
                      <div className="artifact-main"><div><strong>{version.packageName || version.fileName}</strong>{version.isExample ? <span className="example-chip">{c("示例", "Example")}</span> : <span className="saved-chip">{version.status === "verified" || version.status === "stable" ? c("可烧录", "Ready") : c("待适配", "Needs setup")}</span>}</div><p>{version.packageName ? `${version.hardwareProjectName} · ` : ""}{version.fileType} · {formatBytes(version.fileSize)}{version.hardwareProfileId === "stmweb.dot-v1" ? ` · DOT V1 · ${version.artifactRole === "complete-image" ? c("完整固件（含 Bootloader）", "Complete image (includes Bootloader)") : c("应用固件（保留 Bootloader）", "Application (keeps Bootloader)")}` : ""}</p><code>SHA-256 {version.sha256.slice(0, 16)}…</code></div>
                      <time>{sessionDateFormatter.format(new Date(version.createdAt))}</time>
                    </article>
                  ))}
                </div>
              </section>
              <div className="notice-card"><ShieldCheck size={20} /><div><strong>{c("每次写入前都重新校验", "Every flash is checked again")}</strong><p>{c("SWD 会核对芯片、容量和写入范围；无线烧录会重新核对硬件、应用分区和完整性。", "SWD checks the chip, capacity and write range. Wireless flashing re-checks the hardware, application partition and integrity.")}</p></div></div>
            </section>
          ) : null}

          {activeView === "sessions" ? (
            <section className="page-section" aria-labelledby="sessions-heading">
              <div className="page-heading"><div><span className="panel-kicker">{c("调试账本", "Debug ledger")}</span><h1 id="sessions-heading">{c("会话记录", "Session history")}</h1><p>{c("连接方式、设备、时间和全部事件属于同一次可追溯记录。", "Connection, device, timing and every event belong to one traceable record.")}</p></div></div>
              {sessions.length === 0 ? <EmptyState icon={History} title={c("还没有已完成的会话", "No completed sessions yet")} body={c("从调试台连接设备并开始记录，或先运行一次演示。", "Connect a device and start recording, or run the demo first.")} action={<button className="secondary-button" type="button" onClick={() => setActiveView("console")}>{c("返回调试台", "Return to Workbench")}</button>} /> : (
                <div className="session-list">{sessions.map((session) => <article className="session-card" key={session.id}><span className="session-icon"><ListRestart size={20} /></span><div><div><strong>{session.deviceName}</strong>{session.isDemo ? <span className="example-chip">{c("演示", "Demo")}</span> : null}</div><p>{session.connectionLabel} · {c(`${session.eventCount} 条记录`, `${session.eventCount} records`)}</p></div><time>{sessionDateFormatter.format(new Date(session.startedAt))}</time><span className="status-complete"><Check size={14} />{c("已完成", "Complete")}</span><button type="button" aria-label={c(`导出 ${session.deviceName} 会话`, `Export ${session.deviceName} session`)} onClick={() => void exportSession(session)}><Download size={17} /></button></article>)}</div>
              )}
            </section>
          ) : null}
          {activeView === "settings" ? <ApiConnectionsSettings accountEmail={user.email || user.username} proAccess={planAccess.pro} workspaceId={workspace.id} /> : null}
          </div>
        </main>
      </div>

      {connectionDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connecting) setConnectionDialogOpen(false); }}>
          <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="dialog-heading"><div><span className="panel-kicker">{c("连接设备", "Connect device")}</span><h2 id="connection-title">{c("选择连接方式", "Choose a connection")}</h2><p>{c("浏览器只会访问你在系统选择器中明确授权的设备。", "The browser accesses only devices you explicitly authorise in the system picker.")}</p></div><button type="button" aria-label={c("关闭连接窗口", "Close connection dialog")} disabled={Boolean(connecting)} onClick={() => setConnectionDialogOpen(false)}><X size={20} /></button></div>
            <div className="connection-options">
              {capabilities.map((capability) => {
                const Icon = capabilityIcons[capability.id];
                const selected = selectedCapability === capability.id;
                return (
                  <button key={capability.id} className={selected ? "connection-option selected" : "connection-option"} type="button" disabled={!capability.supported || Boolean(connecting)} onClick={() => setSelectedCapability(capability.id)}>
                    <span className="connection-option-icon"><Icon size={20} /></span>
                    <span><strong>{capability.label}</strong><small>{capability.description}</small></span>
                    <span className={capability.supported ? "option-status" : "option-status unavailable"}>{capability.supported ? capability.permission : c("不可用", "Unavailable")}</span>
                  </button>
                );
              })}
            </div>
            {selectedCapability === "network" ? (
              <label className="network-field"><span>{c("设备地址", "Device address")}</span><input type="url" inputMode="url" value={networkUrl} onChange={(event) => setNetworkUrl(event.target.value)} placeholder="http://192.168.1.50/health" /><small>{c("设备需要提供可跨域访问的 HTTP 健康检查地址。", "The device must expose an HTTP health endpoint that allows cross-origin access.")}</small></label>
            ) : null}
            {selectedCapability === "serial" ? (
              <div className="serial-settings" aria-label={c("串口参数", "Serial settings")}>
                <div className="serial-channel"><span>{c("端口通道", "Port")}</span><strong>{c("下一步在系统选择器中选择 COM / tty 端口", "Choose a COM / tty port in the system picker next")}</strong></div>
                <label><span>{c("波特率", "Baud rate")}</span><select value={serialBaudRate} onChange={(event) => setSerialBaudRate(event.target.value)}>{commonBaudRates.map((rate) => <option key={rate} value={rate}>{rate}</option>)}<option value="custom">{c("自定义", "Custom")}</option></select></label>
                {serialBaudRate === "custom" ? <label><span>{c("自定义波特率", "Custom baud rate")}</span><input type="number" min="300" max="4000000" step="1" value={customBaudRate} onChange={(event) => setCustomBaudRate(event.target.value)} /></label> : null}
                <label><span>{c("数据位", "Data bits")}</span><select value={serialDataBits} onChange={(event) => setSerialDataBits(Number(event.target.value) as 7 | 8)}><option value="8">8</option><option value="7">7</option></select></label>
                <label><span>{c("校验位", "Parity")}</span><select value={serialParity} onChange={(event) => setSerialParity(event.target.value as SerialConnectionOptions["parity"])}><option value="none">{c("无", "None")}</option><option value="even">{c("偶校验", "Even")}</option><option value="odd">{c("奇校验", "Odd")}</option></select></label>
                <label><span>{c("停止位", "Stop bits")}</span><select value={serialStopBits} onChange={(event) => setSerialStopBits(Number(event.target.value) as 1 | 2)}><option value="1">1</option><option value="2">2</option></select></label>
                <label><span>{c("流控", "Flow control")}</span><select value={serialFlowControl} onChange={(event) => setSerialFlowControl(event.target.value as SerialConnectionOptions["flowControl"])}><option value="none">{c("无", "None")}</option><option value="hardware">{c("硬件 RTS/CTS", "Hardware RTS/CTS")}</option></select></label>
              </div>
            ) : null}
            <div className="dialog-footer"><div>{activeCapability ? <><CircleAlert size={16} /><span>{activeCapability.id === "network" ? c("首次访问局域网时，浏览器会请求网络权限。", "The browser will request local-network permission on first access.") : c("下一步将打开浏览器的系统设备选择器。", "The browser's system device picker opens next.")}</span></> : <span>{c("选择一种方式继续", "Choose a connection to continue")}</span>}</div><button className="primary-button" type="button" disabled={!selectedCapability || Boolean(connecting)} onClick={() => selectedCapability && void connectHardware(selectedCapability)}>{connecting ? <Loader2 size={17} className="spinning" /> : <Plug size={17} />}{connecting ? c("正在连接", "Connecting…") : c("继续连接", "Continue")}</button></div>
          </section>
        </div>
      ) : null}

      {deviceDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deviceBusy) setDeviceDialogOpen(false); }}>
          <form className="connection-dialog device-form" role="dialog" aria-modal="true" aria-labelledby="device-form-title" onSubmit={(event) => void submitDevice(event)}>
            <div className="dialog-heading"><div><span className="panel-kicker">{c("设备台账", "Device registry")}</span><h2 id="device-form-title">{c("登记设备", "Register Device")}</h2><p>{c("填写能帮助你识别和定位这台硬件的信息。", "Add details that help you identify and locate this hardware.")}</p></div><button type="button" aria-label={c("关闭", "Close")} disabled={deviceBusy} onClick={() => setDeviceDialogOpen(false)}><X size={20} /></button></div>
            <div className="device-form-grid">
              <label><span>{c("设备名称", "Device name")}</span><input name="name" required maxLength={160} placeholder={c("例如：环境监测主控 A-07", "e.g. Environment Controller A-07")} /></label>
              <label><span>{c("MCU 型号", "MCU model")}</span><input name="model" maxLength={120} placeholder="STM32H743VIT6" /></label>
              <label><span>{c("板卡", "Board")}</span><input name="board" maxLength={120} placeholder={c("环境传感器主板 R3", "Environment Sensor Board R3")} /></label>
              <label><span>{c("位置", "Location")}</span><input name="location" maxLength={160} placeholder={c("工作台 01", "Bench 01")} /></label>
              <label><span>{c("时钟", "Clock")}</span><input name="clock" maxLength={80} placeholder="400 MHz" /></label>
              <label><span>Flash</span><input name="flash" maxLength={80} placeholder="2048 KB" /></label>
              <label><span>{c("当前固件", "Current firmware")}</span><input name="version" maxLength={120} placeholder="v0.8.4" /></label>
              <label><span>{c("备注", "Notes")}</span><input name="note" maxLength={1000} placeholder={c("用途或硬件状态", "Purpose or hardware status")} /></label>
            </div>
            <div className="dialog-footer"><span>{c("保存后可直接选择此设备开始调试。", "After saving, select this device and start debugging.")}</span><button className="primary-button" type="submit" disabled={deviceBusy}>{deviceBusy ? <Loader2 size={17} className="spinning" /> : <Plus size={17} />}{deviceBusy ? c("正在保存", "Saving…") : c("保存设备", "Save Device")}</button></div>
          </form>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.tone}`} role="status"><span>{toast.tone === "success" ? <Check size={17} /> : toast.tone === "warning" ? <CircleAlert size={17} /> : <CircleDot size={17} />}</span>{toast.message}</div> : null}
    </div>
  );
}

export default App;

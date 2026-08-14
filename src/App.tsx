import {
  Activity,
  Bluetooth,
  Box,
  Cable,
  Check,
  CircleAlert,
  CircleDot,
  Clock3,
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
  Pause,
  Play,
  Plug,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  SquareTerminal,
  StepForward,
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
  type DebugEventRecord,
  type DebugSessionRecord,
  type FirmwareVersionRecord,
  type DeviceRecord,
} from "./db.js";
import {
  inspectHardwareCapabilities,
  requestHardwareConnection,
  type HardwareCapability,
  type HardwareCapabilityId,
  type HardwareConnection,
} from "./hardware.js";

type ViewId = "console" | "devices" | "firmware" | "sessions";

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
  user: { id: string; email: string; name: string };
  onSignOut: () => void;
}

const navigation: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: "console", label: "调试台", icon: LayoutDashboard },
  { id: "devices", label: "设备台账", icon: Cpu },
  { id: "firmware", label: "固件版本", icon: Box },
  { id: "sessions", label: "会话记录", icon: History },
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

const exampleFirmware = {
  id: "example-v084",
  fileName: "env-node-v0.8.4.elf",
  fileSize: 726_304,
  fileType: "ELF",
  sha256: "4f390d4c1b83a2f7",
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

const sessionDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function App({ workspace, user, onSignOut }: AppProps) {
  const [activeView, setActiveView] = useState<ViewId>("console");
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<HardwareCapability[]>([]);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<HardwareCapabilityId | null>(null);
  const [networkUrl, setNetworkUrl] = useState("http://192.168.1.50/health");
  const [connecting, setConnecting] = useState<HardwareCapabilityId | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [currentSession, setCurrentSession] = useState<DebugSessionRecord | null>(null);
  const [sessions, setSessions] = useState<DebugSessionRecord[]>([]);
  const [firmwareVersions, setFirmwareVersions] = useState<FirmwareVersionRecord[]>([]);
  const [logs, setLogs] = useState<DebugEventRecord[]>([]);
  const [telemetry, setTelemetry] = useState<number[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [fileBusy, setFileBusy] = useState(false);

  const connectionRef = useRef<HardwareConnection | null>(null);
  const currentSessionRef = useRef<DebugSessionRecord | null>(null);
  const sequenceRef = useRef(0);
  const demoIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? emptyDevice;
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
        setToast({ tone: "warning", message: "工作区数据暂时无法加载，请检查网络后重试" });
      });

    return () => {
      active = false;
    };
  }, [workspace.id]);

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
      setToast({ tone: "success", message: `${device.name} 已加入设备台账` });
    } catch (reason) {
      setToast({ tone: "warning", message: reason instanceof Error ? reason.message : "设备保存失败" });
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
    setToast({ tone: "warning", message: "调试记录尚未保存，请检查网络后重试" });
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
      connectionLabel: options.label ?? connectionInfo?.name ?? "浏览器设备",
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
    void saveSession(session).catch(handleStorageError);
    appendEvent("success", `会话已开始 · ${session.connectionLabel}`);

    if (isDemo) {
      let tick = 0;
      demoIntervalRef.current = window.setInterval(() => {
        tick += 1;
        const temperature = 24.1 + Math.sin(tick / 4) * 1.3 + Math.random() * 0.2;
        const voltage = 3.29 + Math.sin(tick / 7) * 0.025;
        const signal = -54 + Math.round(Math.sin(tick / 3) * 4);
        setTelemetry((current) => [...current, temperature].slice(-48));
        appendEvent("data", `TEMP=${temperature.toFixed(2)}°C  VBUS=${voltage.toFixed(3)}V  RSSI=${signal}dBm`, {
          temperature: Number(temperature.toFixed(2)),
          voltage: Number(voltage.toFixed(3)),
          signal,
        });
        if (tick % 7 === 0) appendEvent("info", "传感器采样周期稳定 · 1000 ms");
      }, 900);
    }

    setToast({ tone: "success", message: isDemo ? "演示会话正在记录" : "调试会话正在记录" });
  }

  async function stopSession() {
    if (demoIntervalRef.current !== null) {
      window.clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    if (!currentSessionRef.current) return;
    appendEvent("info", "记录已停止，数据已写入工作区台账");
    const completed: DebugSessionRecord = {
      ...currentSessionRef.current,
      endedAt: new Date().toISOString(),
      status: "completed",
    };
    currentSessionRef.current = null;
    setCurrentSession(null);
    setSessions((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
    await saveSession(completed).catch(handleStorageError);
    setToast({ tone: "success", message: `已保存 ${completed.eventCount} 条调试记录` });
  }

  function beginDemoSession() {
    if (!connectionInfo) {
      setConnectionInfo({
        name: "演示设备",
        detail: "生成可识别的模拟遥测，不会操作真实硬件",
        kind: "demo",
        isDemo: true,
      });
    }
    startSession({ isDemo: true, label: "演示设备" });
  }

  async function connectHardware(kind: HardwareCapabilityId) {
    setConnecting(kind);
    try {
      const connection = await requestHardwareConnection(kind, {
        networkUrl,
        onSerialText: (text) => appendEvent("data", text.trim() || "收到串口数据"),
      });
      connectionRef.current = connection;
      setConnectionInfo({
        name: connection.name,
        detail: connection.detail,
        kind: connection.kind,
        isDemo: false,
      });
      setConnectionDialogOpen(false);
      setSelectedCapability(null);
      setToast({ tone: "success", message: `${connection.name} 已连接` });
    } catch (error) {
      setToast({
        tone: "warning",
        message: error instanceof Error ? error.message : "设备连接失败，请重试",
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
    setTelemetry([]);
    setLogs([]);
    setToast({ tone: "info", message: "设备连接已断开" });
  }

  async function importFirmware(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileBusy(true);
    try {
      const sha256 = await hashFile(file);
      const version: FirmwareVersionRecord = {
        id: crypto.randomUUID(),
        projectId: workspace.id,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.name.split(".").pop()?.toUpperCase() || file.type || "FILE",
        sha256,
        createdAt: new Date().toISOString(),
        blob: file,
      };
      const savedVersion = await saveFirmwareVersion(version);
      setFirmwareVersions((current) => [savedVersion, ...current.filter((item) => item.id !== savedVersion.id)]);
      setToast({ tone: "success", message: `${file.name} 已校验并保存` });
    } catch {
      setToast({ tone: "warning", message: "固件文件保存失败，请检查浏览器存储空间" });
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
      setToast({ tone: "success", message: "会话记录已导出" });
    } catch {
      setToast({ tone: "warning", message: "会话导出失败，请稍后重试" });
    }
  }

  const chartPoints = telemetry.length > 1
    ? telemetry.map((value, index) => {
        const x = (index / Math.max(telemetry.length - 1, 1)) * 720;
        const y = 168 - ((value - 21.5) / 6) * 128;
        return `${x.toFixed(1)},${Math.max(18, Math.min(172, y)).toFixed(1)}`;
      }).join(" ")
    : "";

  const currentTemperature = telemetry.at(-1);
  const storageLabel = storageHealthy ? "工作区数据库" : "暂不可用";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>

      <aside className="sidebar" aria-label="主导航">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true"><Activity size={22} /></span>
          <div>
            <strong>STMWEB</strong>
            <span>硬件调试工作台</span>
          </div>
        </div>

        <div className="workspace-select" aria-label="当前工作区">
          <span className="workspace-avatar">H</span>
          <span><small>当前工作区</small><strong>{workspace.name}</strong></span>
        </div>

        <nav className="main-nav">
          <span className="nav-label">工作区</span>
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
                <span>{item.label}</span>
                {item.id === "sessions" && sessions.length > 0 ? <b>{sessions.length}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-devices">
          <div className="section-heading compact">
            <span>最近设备</span>
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
          <div><strong>{storageHealthy ? "自动记录已开启" : "记录存储受限"}</strong><span>{storageLabel}</span></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{workspace.name}</span><span>/</span><strong>{selectedDevice.name}</strong>
          </div>
          <div className="topbar-status">
            <span className="environment-badge"><span />数据已同步</span>
            <button className="account-button" type="button" onClick={onSignOut} title={`${user.name} · 退出登录`}>
              <span className="account-mark">{user.name.slice(0, 2).toUpperCase()}</span>
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {activeView === "console" ? (
            <>
              <section className="device-hero" aria-labelledby="device-title">
                <div className="hero-device-icon" aria-hidden="true"><Cpu size={28} /></div>
                <div className="hero-copy">
                  <div className="eyebrow-row">
                    <span className={connectionInfo ? "state-pill online" : "state-pill"}>
                      <span />{connectionInfo ? "已连接" : "等待连接"}
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
                        {currentSession ? <><Square size={17} />停止记录</> : <><CircleDot size={17} />开始记录</>}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void disconnectHardware()}>
                        断开
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="primary-button" type="button" onClick={() => setConnectionDialogOpen(true)}>
                        <Plug size={17} aria-hidden="true" />连接设备
                      </button>
                      <button className="secondary-button" type="button" onClick={beginDemoSession}>
                        <Play size={17} aria-hidden="true" />试用演示
                      </button>
                    </>
                  )}
                </div>
              </section>

              <section className="metrics-grid" aria-label="设备摘要">
                <MetricCard label="当前固件" value={selectedDevice.version || "未关联"} note="设备台账" icon={FileCode2} />
                <MetricCard label="已存会话" value={String(sessions.length)} note="工作区数据库" icon={Database} />
                <MetricCard label="连接方式" value={connectionInfo ? connectionInfo.kind.toUpperCase() : "—"} note={connectionInfo ? connectionInfo.name : "尚未选择"} icon={Cable} />
                <MetricCard label="实时温度" value={currentTemperature ? `${currentTemperature.toFixed(1)}°C` : "—"} note={currentSession?.isDemo ? "演示遥测" : "等待数据"} icon={Gauge} />
              </section>

              <section className="dashboard-grid">
                <article className="panel chart-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">实时遥测</span><h2>传感器温度</h2></div>
                    <span className="live-indicator"><span />{currentSession ? "正在记录" : "暂无数据"}</span>
                  </div>
                  <div className="chart-wrap">
                    <div className="chart-summary">
                      <strong>{currentTemperature ? currentTemperature.toFixed(2) : "--.--"}<small>°C</small></strong>
                      <span>最近 48 个采样点</span>
                    </div>
                    <svg className="telemetry-chart" viewBox="0 0 720 190" role="img" aria-label={currentTemperature ? `当前温度 ${currentTemperature.toFixed(2)} 摄氏度` : "尚无温度数据"}>
                      {[34, 78, 122, 166].map((y) => <line key={y} x1="0" y1={y} x2="720" y2={y} className="grid-line" />)}
                      {chartPoints ? (
                        <>
                          <polyline points={chartPoints} className="chart-glow" />
                          <polyline points={chartPoints} className="chart-line" />
                        </>
                      ) : (
                        <line x1="0" y1="100" x2="720" y2="100" className="empty-line" />
                      )}
                    </svg>
                  </div>
                  <div className="chart-legend">
                    <span><i className="legend-dot temperature" />温度</span>
                    <span><Clock3 size={14} />采样间隔 1 秒</span>
                  </div>
                </article>

                <article className="panel controls-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">目标控制</span><h2>运行状态</h2></div>
                    <span className={connectionInfo?.isDemo ? "target-state ready" : "target-state"}>
                      {connectionInfo?.isDemo ? "演示可用" : connectionInfo ? "仅数据连接" : "未连接"}
                    </span>
                  </div>
                  <div className="control-cluster">
                    {[
                      { label: "复位", icon: RotateCcw },
                      { label: "运行", icon: Play },
                      { label: "暂停", icon: Pause },
                      { label: "单步", icon: StepForward },
                    ].map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={!connectionInfo?.isDemo}
                        onClick={() => appendEvent("success", `演示设备已执行：${label}`)}
                      >
                        <Icon size={18} aria-hidden="true" /><span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <dl className="target-facts">
                    <div><dt>MCU</dt><dd>{selectedDevice.model}</dd></div>
                    <div><dt>时钟</dt><dd>{selectedDevice.clock}</dd></div>
                    <div><dt>Flash</dt><dd>{selectedDevice.flash}</dd></div>
                    <div><dt>连接</dt><dd>{connectionInfo?.kind.toUpperCase() ?? "—"}</dd></div>
                  </dl>
                  <button className="text-action" type="button" onClick={() => setActiveView("firmware")}>
                    <Upload size={16} />导入固件版本
                  </button>
                </article>

                <article className="panel terminal-panel">
                  <div className="panel-heading terminal-heading">
                    <div><span className="panel-kicker">会话输出</span><h2>调试终端</h2></div>
                    <span>{logs.length} 条</span>
                  </div>
                  <div className="terminal" ref={terminalRef} role="log" aria-label="调试会话输出">
                    {logs.length === 0 ? (
                      <div className="terminal-empty"><SquareTerminal size={22} /><span>连接设备或启动演示后，输出会显示在这里。</span></div>
                    ) : logs.map((log) => (
                      <div className={`log-line ${log.level}`} key={log.id}>
                        <time>{new Date(log.recordedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time>
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel capability-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">浏览器环境</span><h2>本机连接能力</h2></div>
                    <button type="button" aria-label="重新检测" onClick={() => void inspectHardwareCapabilities().then(setCapabilities)}>
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <div className="capability-list">
                    {capabilities.length === 0 ? (
                      <div className="capability-loading"><Loader2 size={18} />正在检测浏览器能力</div>
                    ) : capabilities.map((capability) => {
                      const Icon = capabilityIcons[capability.id];
                      return (
                        <div className="capability-row" key={capability.id}>
                          <span className="capability-icon"><Icon size={17} /></span>
                          <span><strong>{capability.label}</strong><small>{capability.permission}</small></span>
                          <span className={capability.supported ? "support-mark supported" : "support-mark"}>
                            {capability.supported ? <Check size={15} /> : <X size={15} />}
                            {capability.supported ? "可用" : "不可用"}
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
              <div className="page-heading"><div><span className="panel-kicker">设备台账</span><h1 id="devices-heading">实体设备</h1><p>每台硬件保留稳定身份、固件版本和调试历史。</p></div><button className="primary-button" type="button" onClick={() => setDeviceDialogOpen(true)}><Plus size={17} />登记设备</button></div>
              {devices.length === 0 ? <EmptyState icon={Cpu} title="还没有设备" body="先登记一台 STM32 设备，再开始连接和记录调试数据。" action={<button className="primary-button" type="button" onClick={() => setDeviceDialogOpen(true)}><Plus size={17} />登记第一台设备</button>} /> : <div className="table-panel">
                <table>
                  <thead><tr><th>设备</th><th>主控</th><th>板卡</th><th>位置</th><th>当前固件</th><th>状态</th></tr></thead>
                  <tbody>{devices.map((device) => <tr key={device.id} onClick={() => setSelectedDeviceId(device.id)}><td><strong>{device.name}</strong><small>{device.note || "—"}</small></td><td>{device.model || "—"}</td><td>{device.board || "—"}</td><td>{device.location || "—"}</td><td><span className="version-chip">{device.version || "未关联"}</span></td><td><span className={device.id === selectedDevice.id && connectionInfo ? "state-pill online" : "state-pill"}><span />{device.id === selectedDevice.id && connectionInfo ? "已连接" : "离线"}</span></td></tr>)}</tbody>
                </table>
              </div>}
            </section>
          ) : null}

          {activeView === "firmware" ? (
            <section className="page-section" aria-labelledby="firmware-heading">
              <div className="page-heading"><div><span className="panel-kicker">版本化管理</span><h1 id="firmware-heading">固件制品</h1><p>导入文件后计算 SHA-256，并完整保存到工作区数据库。</p></div><button className="primary-button" type="button" disabled={fileBusy} onClick={() => fileInputRef.current?.click()}>{fileBusy ? <Loader2 size={17} className="spinning" /> : <Upload size={17} />}{fileBusy ? "正在校验" : "导入固件"}</button></div>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".bin,.hex,.elf,.axf,.srec" onChange={(event) => void importFirmware(event)} />
              <div className="artifact-grid">
                {combinedFirmware.map((version) => (
                  <article className="artifact-card" key={version.id}>
                    <span className="artifact-icon"><FileCode2 size={21} /></span>
                    <div className="artifact-main"><div><strong>{version.fileName}</strong>{version.isExample ? <span className="example-chip">示例</span> : <span className="saved-chip">已保存</span>}</div><p>{version.fileType} · {formatBytes(version.fileSize)}</p><code>SHA-256 {version.sha256.slice(0, 16)}…</code></div>
                    <time>{sessionDateFormatter.format(new Date(version.createdAt))}</time>
                  </article>
                ))}
              </div>
              <div className="notice-card"><ShieldCheck size={20} /><div><strong>制品不会被原地覆盖</strong><p>同名文件也会作为新版本保存。当前版本仅保存和校验文件，暂不执行烧录。</p></div></div>
            </section>
          ) : null}

          {activeView === "sessions" ? (
            <section className="page-section" aria-labelledby="sessions-heading">
              <div className="page-heading"><div><span className="panel-kicker">调试账本</span><h1 id="sessions-heading">会话记录</h1><p>连接方式、设备、时间和全部事件属于同一次可追溯记录。</p></div></div>
              {sessions.length === 0 ? <EmptyState icon={History} title="还没有已完成的会话" body="从调试台连接设备并开始记录，或先运行一次演示。" action={<button className="secondary-button" type="button" onClick={() => setActiveView("console")}>返回调试台</button>} /> : (
                <div className="session-list">{sessions.map((session) => <article className="session-card" key={session.id}><span className="session-icon"><ListRestart size={20} /></span><div><div><strong>{session.deviceName}</strong>{session.isDemo ? <span className="example-chip">演示</span> : null}</div><p>{session.connectionLabel} · {session.eventCount} 条记录</p></div><time>{sessionDateFormatter.format(new Date(session.startedAt))}</time><span className="status-complete"><Check size={14} />已完成</span><button type="button" aria-label={`导出 ${session.deviceName} 会话`} onClick={() => void exportSession(session)}><Download size={17} /></button></article>)}</div>
              )}
            </section>
          ) : null}
        </main>
      </div>

      {connectionDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connecting) setConnectionDialogOpen(false); }}>
          <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="dialog-heading"><div><span className="panel-kicker">连接设备</span><h2 id="connection-title">选择连接方式</h2><p>浏览器只会访问你在系统选择器中明确授权的设备。</p></div><button type="button" aria-label="关闭连接窗口" disabled={Boolean(connecting)} onClick={() => setConnectionDialogOpen(false)}><X size={20} /></button></div>
            <div className="connection-options">
              {capabilities.map((capability) => {
                const Icon = capabilityIcons[capability.id];
                const selected = selectedCapability === capability.id;
                return (
                  <button key={capability.id} className={selected ? "connection-option selected" : "connection-option"} type="button" disabled={!capability.supported || Boolean(connecting)} onClick={() => setSelectedCapability(capability.id)}>
                    <span className="connection-option-icon"><Icon size={20} /></span>
                    <span><strong>{capability.label}</strong><small>{capability.description}</small></span>
                    <span className={capability.supported ? "option-status" : "option-status unavailable"}>{capability.supported ? capability.permission : "不可用"}</span>
                  </button>
                );
              })}
            </div>
            {selectedCapability === "network" ? (
              <label className="network-field"><span>设备地址</span><input type="url" value={networkUrl} onChange={(event) => setNetworkUrl(event.target.value)} placeholder="http://192.168.1.50/health" /><small>设备需要提供可跨域访问的 HTTP 健康检查地址。</small></label>
            ) : null}
            <div className="dialog-footer"><div>{activeCapability ? <><CircleAlert size={16} /><span>{activeCapability.id === "network" ? "首次访问局域网时，浏览器会请求网络权限。" : "下一步将打开浏览器的系统设备选择器。"}</span></> : <span>选择一种方式继续</span>}</div><button className="primary-button" type="button" disabled={!selectedCapability || Boolean(connecting)} onClick={() => selectedCapability && void connectHardware(selectedCapability)}>{connecting ? <Loader2 size={17} className="spinning" /> : <Plug size={17} />}{connecting ? "正在连接" : "继续连接"}</button></div>
          </section>
        </div>
      ) : null}

      {deviceDialogOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deviceBusy) setDeviceDialogOpen(false); }}>
          <form className="connection-dialog device-form" role="dialog" aria-modal="true" aria-labelledby="device-form-title" onSubmit={(event) => void submitDevice(event)}>
            <div className="dialog-heading"><div><span className="panel-kicker">设备台账</span><h2 id="device-form-title">登记设备</h2><p>填写能帮助你识别和定位这台硬件的信息。</p></div><button type="button" aria-label="关闭" disabled={deviceBusy} onClick={() => setDeviceDialogOpen(false)}><X size={20} /></button></div>
            <div className="device-form-grid">
              <label><span>设备名称</span><input name="name" required maxLength={160} placeholder="例如：环境监测主控 A-07" /></label>
              <label><span>MCU 型号</span><input name="model" maxLength={120} placeholder="STM32H743VIT6" /></label>
              <label><span>板卡</span><input name="board" maxLength={120} placeholder="环境传感器主板 R3" /></label>
              <label><span>位置</span><input name="location" maxLength={160} placeholder="工作台 01" /></label>
              <label><span>时钟</span><input name="clock" maxLength={80} placeholder="400 MHz" /></label>
              <label><span>Flash</span><input name="flash" maxLength={80} placeholder="2048 KB" /></label>
              <label><span>当前固件</span><input name="version" maxLength={120} placeholder="v0.8.4" /></label>
              <label><span>备注</span><input name="note" maxLength={1000} placeholder="用途或硬件状态" /></label>
            </div>
            <div className="dialog-footer"><span>保存后可直接选择此设备开始调试。</span><button className="primary-button" type="submit" disabled={deviceBusy}>{deviceBusy ? <Loader2 size={17} className="spinning" /> : <Plus size={17} />}{deviceBusy ? "正在保存" : "保存设备"}</button></div>
          </form>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.tone}`} role="status"><span>{toast.tone === "success" ? <Check size={17} /> : toast.tone === "warning" ? <CircleAlert size={17} /> : <CircleDot size={17} />}</span>{toast.message}</div> : null}
    </div>
  );
}

export default App;

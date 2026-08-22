import {
  Activity,
  BatteryMedium,
  Camera,
  Check,
  ChevronDown,
  Cpu,
  FileCode2,
  Gauge,
  ListChecks,
  SlidersHorizontal,
  SquareTerminal,
  VideoOff,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  componentLabels,
  type DeviceCapabilityManifest,
  type DeviceCapabilityType,
} from "./device-capabilities.js";
import { useLocale } from "./i18n.js";

interface TelemetrySnapshot {
  pitch: number;
  roll: number;
  gyro: number;
  leftSpeed: number;
  rightSpeed: number;
  leftPwm: number;
  rightPwm: number;
  voltage: number;
  lineOffset: number;
  lineAngle: number;
  balanceKp: number;
  balanceKi: number;
  balanceKd: number;
  velocityKp: number;
  velocityKi: number;
  velocityKd: number;
  averagePwm: number;
}

interface DeviceWorkbenchProps {
  manifest: DeviceCapabilityManifest;
  selected: DeviceCapabilityType[];
  telemetry: TelemetrySnapshot;
  isDemo: boolean;
  proAccess: boolean;
  onOpenFirmware: () => void;
  onChange: (selected: DeviceCapabilityType[]) => void;
}

const componentIcons: Record<DeviceCapabilityType, LucideIcon> = {
  orientation: Activity,
  camera: Camera,
  motor: Gauge,
  battery: BatteryMedium,
  chart: Activity,
  terminal: SquareTerminal,
  controls: SlidersHorizontal,
  events: ListChecks,
  firmware: FileCode2,
};

const englishComponentLabels: Record<DeviceCapabilityType, string> = {
  orientation: "Orientation", camera: "Camera", motor: "Motor", battery: "Battery", chart: "Charts",
  terminal: "Terminal", controls: "Controls", events: "Events", firmware: "Firmware Build",
};

function availableTypes(manifest: DeviceCapabilityManifest): DeviceCapabilityType[] {
  const values = new Set(manifest.capabilities.map((capability) => capability.type));
  values.add("terminal");
  values.add("events");
  values.add("firmware");
  return [...values];
}

export function DeviceWorkbench({ manifest, selected, telemetry, isDemo, proAccess, onOpenFirmware, onChange }: DeviceWorkbenchProps) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const statusLabel = (status: string) => status === "online" ? c("在线", "Online") : status === "degraded" ? c("受限", "Degraded") : status === "offline" ? c("离线", "Offline") : c("待确认", "Unknown");
  const [pickerOpen, setPickerOpen] = useState(true);
  const available = availableTypes(manifest);
  const hasAveragePwm = manifest.capabilities.some((capability) => capability.type === "motor" && capability.channels.includes("averagePwm"));

  function toggle(type: DeviceCapabilityType) {
    onChange(selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type]);
  }

  return (
    <section className="device-workbench" aria-labelledby="workbench-title">
      <div className="workbench-heading">
        <div>
          <span className="panel-kicker">{c("已识别设备能力", "Detected device capabilities")}</span>
          <h2 id="workbench-title">{c("选择本次要看的内容", "Choose what to include")}</h2>
          <p>{manifest.device.model} · {c("固件", "Firmware")} {manifest.device.firmwareVersion}</p>
        </div>
        <button className="secondary-button component-picker-toggle" type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}>
          <SlidersHorizontal size={17} />{c("自定义工作台", "Customise Workbench")}<ChevronDown className={pickerOpen ? "chevron-open" : ""} size={16} />
        </button>
      </div>

      {pickerOpen ? (
        <fieldset className="component-picker">
          <legend>{c("可用组件", "Available components")}</legend>
          {available.map((type) => {
            const Icon = componentIcons[type];
            const enabled = selected.includes(type);
            const capabilities = manifest.capabilities.filter((capability) => capability.type === type);
            const online = capabilities.length === 0 || capabilities.some((capability) => capability.status !== "offline");
            return (
              <label className={enabled ? "component-choice selected" : "component-choice"} key={type}>
                <input type="checkbox" checked={enabled} disabled={!online} onChange={() => toggle(type)} />
                <span className="component-choice-icon"><Icon size={19} /></span>
                <span><strong>{isEnglish ? englishComponentLabels[type] : componentLabels[type]}</strong><small>{online ? c("可加入本次调试", "Available for this session") : c("硬件当前离线", "Hardware is offline")}</small></span>
                <span className="component-check">{enabled ? <Check size={16} /> : null}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {selected.length === 0 ? (
        <div className="workbench-empty"><Cpu size={24} /><strong>{c("还没有选择调试组件", "No debugging components selected")}</strong><span>{c("从上方选择本次需要查看或操作的内容。", "Choose what you want to monitor or control above.")}</span></div>
      ) : (
        <div className="workbench-grid">
          {selected.includes("camera") ? (
            <article className="workbench-card camera-widget">
              <div className="widget-heading"><div><Camera size={18} /><strong>{c("摄像头与视觉识别", "Camera & Vision")}</strong></div><span className="widget-state"><i />{isDemo ? c("演示画面", "Demo feed") : c("等待视频", "Waiting for video")}</span></div>
              <div className="camera-stage">
                {isDemo ? <><div className="demo-road"><span /></div><div className="camera-reticle" /><span className="camera-overlay">{c("循迹偏移", "Line offset")} {telemetry.lineOffset.toFixed(1)} px · {c("转角", "Angle")} {telemetry.lineAngle.toFixed(1)}°</span></> : <div className="camera-empty"><VideoOff size={28} /><span>{c("摄像头端点连接后在这里显示画面", "The video feed appears here after the camera endpoint connects")}</span></div>}
              </div>
            </article>
          ) : null}

          {selected.includes("orientation") ? (
            <article className="workbench-card orientation-widget">
              <div className="widget-heading"><div><Activity size={18} /><strong>{c("姿态与陀螺仪", "Orientation & Gyroscope")}</strong></div><span>50 Hz</span></div>
              <div className="orientation-body">
                <div className="orientation-model" style={{ transform: `rotateX(${telemetry.pitch / 3}deg) rotateZ(${telemetry.roll / 3}deg)` }}><span /></div>
                <dl><div><dt>{c("俯仰", "Pitch")}</dt><dd>{telemetry.pitch.toFixed(1)}°</dd></div><div><dt>{c("横滚", "Roll")}</dt><dd>{telemetry.roll.toFixed(1)}°</dd></div><div><dt>{c("角速度", "Angular velocity")}</dt><dd>{telemetry.gyro.toFixed(1)} °/s</dd></div></dl>
              </div>
            </article>
          ) : null}

          {selected.includes("motor") ? (
            <article className="workbench-card motor-widget">
              <div className="widget-heading"><div><Gauge size={18} /><strong>{c("电机输出", "Motor Output")}</strong></div><span>{hasAveragePwm ? c("左右平均", "Combined average") : c("独立通道", "Independent channels")}</span></div>
              {hasAveragePwm ? <div className="motor-pair"><div className="motor-channel"><span className={telemetry.averagePwm >= 0 ? "motor-ring forward" : "motor-ring reverse"}><i /></span><strong>{c("平均 PWM", "Average PWM")}</strong><b>{Math.abs(telemetry.averagePwm).toFixed(0)}</b><span>{telemetry.averagePwm >= 0 ? c("正向输出", "Forward output") : c("反向输出", "Reverse output")}</span></div></div> : <div className="motor-pair">
                {[{ name: c("左电机", "Left motor"), speed: telemetry.leftSpeed, pwm: telemetry.leftPwm }, { name: c("右电机", "Right motor"), speed: telemetry.rightSpeed, pwm: telemetry.rightPwm }].map((motor) => (
                  <div className="motor-channel" key={motor.name}><span className={motor.speed >= 0 ? "motor-ring forward" : "motor-ring reverse"}><i /></span><strong>{motor.name}</strong><b>{Math.abs(motor.speed).toFixed(0)} <small>rpm</small></b><span>{motor.speed >= 0 ? c("正转", "Forward") : c("反转", "Reverse")} · PWM {Math.abs(motor.pwm).toFixed(0)}%</span></div>
                ))}
              </div>}
            </article>
          ) : null}

          {selected.includes("battery") ? (
            <article className="workbench-card battery-widget">
              <div className="widget-heading"><div><BatteryMedium size={18} /><strong>{c("电池状态", "Battery Status")}</strong></div><span className={telemetry.voltage < 3.3 ? "warning-text" : "healthy-text"}>{telemetry.voltage < 3.3 ? c("电量偏低", "Low battery") : c("状态正常", "Healthy")}</span></div>
              <div className="battery-body"><div className="battery-shape"><span style={{ width: `${Math.min(100, Math.max(5, (telemetry.voltage - 3) / 1.2 * 100))}%` }} /></div><strong>{telemetry.voltage.toFixed(2)} V</strong><span>{c("烧录安全阈值 3.30 V", "Safe flashing threshold 3.30 V")}</span></div>
            </article>
          ) : null}

          {selected.includes("controls") ? (
            <article className="workbench-card controls-widget">
              <div className="widget-heading"><div><SlidersHorizontal size={18} /><strong>{c("参数与控制", "Parameters & Controls")}</strong></div><span>{c("设备范围保护", "Device range protection")}</span></div>
              <div className="parameter-list"><label><span>{c("平衡 Kp", "Balance Kp")}</span><input type="range" min="0" max="200" value={telemetry.balanceKp} readOnly disabled={!isDemo} /><output>{telemetry.balanceKp.toFixed(1)}</output></label><label><span>{c("平衡 Ki", "Balance Ki")}</span><input type="range" min="0" max="10" step="0.1" value={telemetry.balanceKi} readOnly disabled={!isDemo} /><output>{telemetry.balanceKi.toFixed(3)}</output></label><label><span>{c("平衡 Kd", "Balance Kd")}</span><input type="range" min="0" max="10" step="0.1" value={telemetry.balanceKd} readOnly disabled={!isDemo} /><output>{telemetry.balanceKd.toFixed(3)}</output></label><label><span>{c("速度 Kp", "Velocity Kp")}</span><input type="range" min="0" max="200" value={telemetry.velocityKp} readOnly disabled={!isDemo} /><output>{telemetry.velocityKp.toFixed(1)}</output></label><label><span>{c("速度 Ki", "Velocity Ki")}</span><input type="range" min="0" max="10" step="0.1" value={telemetry.velocityKi} readOnly disabled={!isDemo} /><output>{telemetry.velocityKi.toFixed(3)}</output></label><label><span>{c("速度 Kd", "Velocity Kd")}</span><input type="range" min="0" max="10" step="0.1" value={telemetry.velocityKd} readOnly disabled={!isDemo} /><output>{telemetry.velocityKd.toFixed(3)}</output></label></div>
            </article>
          ) : null}

          {selected.includes("chart") ? (
            <article className="workbench-card compact-chart-widget">
              <div className="widget-heading"><div><Activity size={18} /><strong>{c("实时数据曲线", "Live Data Chart")}</strong></div><span>{c("最近 30 秒", "Last 30 seconds")}</span></div>
              <svg viewBox="0 0 600 120" role="img" aria-label={c("姿态与左右电机实时趋势", "Live orientation and motor trends")}><path d="M0 62 C70 20,105 100,170 55 S275 18,340 64 S455 108,600 43" className="series orientation" /><path d="M0 88 C80 65,130 102,205 72 S330 48,400 82 S510 65,600 70" className="series motor" /></svg>
              <div className="widget-legend"><span><i className="orientation-dot" />{c("姿态", "Orientation")}</span><span><i className="motor-dot" />{c("电机", "Motor")}</span></div>
            </article>
          ) : null}

          {selected.includes("firmware") ? <article className="workbench-card compact-action-widget"><FileCode2 size={21} /><div><strong>{c("标准固件生成", "Standard Firmware Generation")}</strong><span>{proAccess ? c("在固件管理中创建硬件项目、生成并直接烧录固件。", "Create a hardware project, generate firmware and flash it from Firmware Management.") : c("固件管理中可以查看烧录入口和 Pro 生成能力。", "Firmware Management contains flashing and Pro generation tools.")}</span></div><button className="secondary-button" type="button" onClick={onOpenFirmware}>{c("打开固件管理", "Open Firmware Management")}</button></article> : null}
          {selected.includes("terminal") ? <article className="workbench-card compact-action-widget"><SquareTerminal size={21} /><div><strong>{c("调试终端", "Debug Terminal")}</strong><span>{c("原始输出继续显示在下方会话终端，并随调试会话保存。", "Raw output remains in the session terminal below and is saved with the debugging session.")}</span></div></article> : null}
          {selected.includes("events") ? <article className="workbench-card compact-action-widget"><ListChecks size={21} /><div><strong>{c("事件记录", "Event History")}</strong><span>{c("连接、参数、控制、构建和烧录操作统一进入当前会话。", "Connections, parameters, controls, builds and flashing actions are recorded in the current session.")}</span></div></article> : null}
        </div>
      )}

      <div className="detected-capabilities" aria-label={c("硬件在线状态", "Hardware availability")}>
        {manifest.capabilities.map((capability) => <span key={capability.id} className={`detected-capability ${capability.status}`}><i />{capability.label} · {statusLabel(capability.status)}</span>)}
      </div>
    </section>
  );
}

export type { TelemetrySnapshot };

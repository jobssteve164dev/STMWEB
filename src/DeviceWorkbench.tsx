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
import { BuildRunnerPanel } from "./BuildRunnerPanel.js";

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

function statusLabel(status: string) {
  if (status === "online") return "在线";
  if (status === "degraded") return "受限";
  if (status === "offline") return "离线";
  return "待确认";
}

function availableTypes(manifest: DeviceCapabilityManifest): DeviceCapabilityType[] {
  const values = new Set(manifest.capabilities.map((capability) => capability.type));
  values.add("terminal");
  values.add("events");
  values.add("firmware");
  return [...values];
}

export function DeviceWorkbench({ manifest, selected, telemetry, isDemo, proAccess, onChange }: DeviceWorkbenchProps) {
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
          <span className="panel-kicker">已识别设备能力</span>
          <h2 id="workbench-title">选择本次要看的内容</h2>
          <p>{manifest.device.model} · 固件 {manifest.device.firmwareVersion}</p>
        </div>
        <button className="secondary-button component-picker-toggle" type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}>
          <SlidersHorizontal size={17} />自定义工作台<ChevronDown className={pickerOpen ? "chevron-open" : ""} size={16} />
        </button>
      </div>

      {pickerOpen ? (
        <fieldset className="component-picker">
          <legend>可用组件</legend>
          {available.map((type) => {
            const Icon = componentIcons[type];
            const enabled = selected.includes(type);
            const capabilities = manifest.capabilities.filter((capability) => capability.type === type);
            const online = capabilities.length === 0 || capabilities.some((capability) => capability.status !== "offline");
            return (
              <label className={enabled ? "component-choice selected" : "component-choice"} key={type}>
                <input type="checkbox" checked={enabled} disabled={!online} onChange={() => toggle(type)} />
                <span className="component-choice-icon"><Icon size={19} /></span>
                <span><strong>{componentLabels[type]}</strong><small>{online ? "可加入本次调试" : "硬件当前离线"}</small></span>
                <span className="component-check">{enabled ? <Check size={16} /> : null}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {selected.length === 0 ? (
        <div className="workbench-empty"><Cpu size={24} /><strong>还没有选择调试组件</strong><span>从上方选择本次需要查看或操作的内容。</span></div>
      ) : (
        <div className="workbench-grid">
          {selected.includes("camera") ? (
            <article className="workbench-card camera-widget">
              <div className="widget-heading"><div><Camera size={18} /><strong>摄像头与视觉识别</strong></div><span className="widget-state"><i />{isDemo ? "演示画面" : "等待视频"}</span></div>
              <div className="camera-stage">
                {isDemo ? <><div className="demo-road"><span /></div><div className="camera-reticle" /><span className="camera-overlay">循迹偏移 {telemetry.lineOffset.toFixed(1)} px · 转角 {telemetry.lineAngle.toFixed(1)}°</span></> : <div className="camera-empty"><VideoOff size={28} /><span>摄像头端点连接后在这里显示画面</span></div>}
              </div>
            </article>
          ) : null}

          {selected.includes("orientation") ? (
            <article className="workbench-card orientation-widget">
              <div className="widget-heading"><div><Activity size={18} /><strong>姿态与陀螺仪</strong></div><span>50 Hz</span></div>
              <div className="orientation-body">
                <div className="orientation-model" style={{ transform: `rotateX(${telemetry.pitch / 3}deg) rotateZ(${telemetry.roll / 3}deg)` }}><span /></div>
                <dl><div><dt>俯仰</dt><dd>{telemetry.pitch.toFixed(1)}°</dd></div><div><dt>横滚</dt><dd>{telemetry.roll.toFixed(1)}°</dd></div><div><dt>角速度</dt><dd>{telemetry.gyro.toFixed(1)} °/s</dd></div></dl>
              </div>
            </article>
          ) : null}

          {selected.includes("motor") ? (
            <article className="workbench-card motor-widget">
              <div className="widget-heading"><div><Gauge size={18} /><strong>电机输出</strong></div><span>{hasAveragePwm ? "左右平均" : "独立通道"}</span></div>
              {hasAveragePwm ? <div className="motor-pair"><div className="motor-channel"><span className={telemetry.averagePwm >= 0 ? "motor-ring forward" : "motor-ring reverse"}><i /></span><strong>平均 PWM</strong><b>{Math.abs(telemetry.averagePwm).toFixed(0)}</b><span>{telemetry.averagePwm >= 0 ? "正向" : "反向"}输出</span></div></div> : <div className="motor-pair">
                {[{ name: "左电机", speed: telemetry.leftSpeed, pwm: telemetry.leftPwm }, { name: "右电机", speed: telemetry.rightSpeed, pwm: telemetry.rightPwm }].map((motor) => (
                  <div className="motor-channel" key={motor.name}><span className={motor.speed >= 0 ? "motor-ring forward" : "motor-ring reverse"}><i /></span><strong>{motor.name}</strong><b>{Math.abs(motor.speed).toFixed(0)} <small>rpm</small></b><span>{motor.speed >= 0 ? "正转" : "反转"} · PWM {Math.abs(motor.pwm).toFixed(0)}%</span></div>
                ))}
              </div>}
            </article>
          ) : null}

          {selected.includes("battery") ? (
            <article className="workbench-card battery-widget">
              <div className="widget-heading"><div><BatteryMedium size={18} /><strong>电池状态</strong></div><span className={telemetry.voltage < 3.3 ? "warning-text" : "healthy-text"}>{telemetry.voltage < 3.3 ? "电量偏低" : "状态正常"}</span></div>
              <div className="battery-body"><div className="battery-shape"><span style={{ width: `${Math.min(100, Math.max(5, (telemetry.voltage - 3) / 1.2 * 100))}%` }} /></div><strong>{telemetry.voltage.toFixed(2)} V</strong><span>烧录安全阈值 3.30 V</span></div>
            </article>
          ) : null}

          {selected.includes("controls") ? (
            <article className="workbench-card controls-widget">
              <div className="widget-heading"><div><SlidersHorizontal size={18} /><strong>参数与控制</strong></div><span>设备范围保护</span></div>
              <div className="parameter-list"><label><span>平衡 Kp</span><input type="range" min="0" max="200" value={telemetry.balanceKp} readOnly disabled={!isDemo} /><output>{telemetry.balanceKp.toFixed(1)}</output></label><label><span>平衡 Ki</span><input type="range" min="0" max="10" step="0.1" value={telemetry.balanceKi} readOnly disabled={!isDemo} /><output>{telemetry.balanceKi.toFixed(3)}</output></label><label><span>平衡 Kd</span><input type="range" min="0" max="10" step="0.1" value={telemetry.balanceKd} readOnly disabled={!isDemo} /><output>{telemetry.balanceKd.toFixed(3)}</output></label><label><span>速度 Kp</span><input type="range" min="0" max="200" value={telemetry.velocityKp} readOnly disabled={!isDemo} /><output>{telemetry.velocityKp.toFixed(1)}</output></label><label><span>速度 Ki</span><input type="range" min="0" max="10" step="0.1" value={telemetry.velocityKi} readOnly disabled={!isDemo} /><output>{telemetry.velocityKi.toFixed(3)}</output></label><label><span>速度 Kd</span><input type="range" min="0" max="10" step="0.1" value={telemetry.velocityKd} readOnly disabled={!isDemo} /><output>{telemetry.velocityKd.toFixed(3)}</output></label></div>
            </article>
          ) : null}

          {selected.includes("chart") ? (
            <article className="workbench-card compact-chart-widget">
              <div className="widget-heading"><div><Activity size={18} /><strong>实时数据曲线</strong></div><span>最近 30 秒</span></div>
              <svg viewBox="0 0 600 120" role="img" aria-label="姿态与左右电机实时趋势"><path d="M0 62 C70 20,105 100,170 55 S275 18,340 64 S455 108,600 43" className="series orientation" /><path d="M0 88 C80 65,130 102,205 72 S330 48,400 82 S510 65,600 70" className="series motor" /></svg>
              <div className="widget-legend"><span><i className="orientation-dot" />姿态</span><span><i className="motor-dot" />电机</span></div>
            </article>
          ) : null}

          {selected.includes("firmware") ? <BuildRunnerPanel proAccess={proAccess} /> : null}
          {selected.includes("terminal") ? <article className="workbench-card compact-action-widget"><SquareTerminal size={21} /><div><strong>调试终端</strong><span>原始输出继续显示在下方会话终端，并随调试会话保存。</span></div></article> : null}
          {selected.includes("events") ? <article className="workbench-card compact-action-widget"><ListChecks size={21} /><div><strong>事件记录</strong><span>连接、参数、控制、构建和烧录操作统一进入当前会话。</span></div></article> : null}
        </div>
      )}

      <div className="detected-capabilities" aria-label="硬件在线状态">
        {manifest.capabilities.map((capability) => <span key={capability.id} className={`detected-capability ${capability.status}`}><i />{capability.label} · {statusLabel(capability.status)}</span>)}
      </div>
    </section>
  );
}

export type { TelemetrySnapshot };

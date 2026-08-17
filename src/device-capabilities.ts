export type DeviceCapabilityType =
  | "orientation"
  | "camera"
  | "motor"
  | "battery"
  | "chart"
  | "terminal"
  | "controls"
  | "events"
  | "firmware";

export type CapabilityStatus = "online" | "offline" | "degraded" | "unknown";

export interface DeviceCapability {
  id: string;
  type: DeviceCapabilityType;
  label: string;
  status: CapabilityStatus;
  channels: string[];
  unit?: string;
  sampleRate?: number;
}

export interface DeviceCapabilityManifest {
  schemaVersion: 1;
  device: {
    id: string;
    model: string;
    firmwareVersion: string;
  };
  capabilities: DeviceCapability[];
}

export const componentLabels: Record<DeviceCapabilityType, string> = {
  orientation: "姿态与陀螺仪",
  camera: "摄像头与视觉识别",
  motor: "电机与编码器",
  battery: "电池状态",
  chart: "实时数据曲线",
  terminal: "调试终端",
  controls: "参数与控制",
  events: "事件记录",
  firmware: "固件与升级",
};

const knownTypes = new Set<DeviceCapabilityType>(Object.keys(componentLabels) as DeviceCapabilityType[]);

export function isDeviceCapabilityManifest(value: unknown): value is DeviceCapabilityManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<DeviceCapabilityManifest>;
  if (manifest.schemaVersion !== 1 || !manifest.device || !Array.isArray(manifest.capabilities)) return false;
  if (!manifest.device.id || !manifest.device.model || !manifest.device.firmwareVersion) return false;
  return manifest.capabilities.every((capability) =>
    Boolean(capability)
    && typeof capability.id === "string"
    && capability.id.length > 0
    && knownTypes.has(capability.type)
    && typeof capability.label === "string"
    && ["online", "offline", "degraded", "unknown"].includes(capability.status)
    && Array.isArray(capability.channels)
    && capability.channels.every((channel) => typeof channel === "string"),
  );
}

export function parseCapabilityManifest(text: string): DeviceCapabilityManifest | null {
  const marker = "STMWEB_CAPS:";
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const line = text.slice(start + marker.length).split(/\r?\n/, 1)[0]?.trim();
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isDeviceCapabilityManifest(value) ? value : null;
  } catch {
    return null;
  }
}

export function recommendedComponents(manifest: DeviceCapabilityManifest): DeviceCapabilityType[] {
  const selected = new Set<DeviceCapabilityType>();
  for (const capability of manifest.capabilities) {
    if (capability.status !== "offline") selected.add(capability.type);
  }
  selected.add("terminal");
  selected.add("events");
  selected.add("firmware");
  return [...selected];
}

export const demoCapabilityManifest: DeviceCapabilityManifest = {
  schemaVersion: 1,
  device: {
    id: "demo-device",
    model: "能力识别演示设备",
    firmwareVersion: "demo-1.0.0",
  },
  capabilities: [
    { id: "imu", type: "orientation", label: "姿态传感器", status: "online", channels: ["pitch", "roll", "gyroX", "gyroY", "gyroZ"], sampleRate: 50 },
    { id: "camera", type: "camera", label: "视觉摄像头", status: "online", channels: ["frame", "lineOffset", "lineAngle"], sampleRate: 10 },
    { id: "drive", type: "motor", label: "双电机", status: "online", channels: ["leftSpeed", "rightSpeed", "leftPwm", "rightPwm"] },
    { id: "battery", type: "battery", label: "动力电池", status: "online", channels: ["voltage", "lowVoltage"] },
    { id: "tuning", type: "controls", label: "运行参数", status: "online", channels: ["balanceKp", "balanceKd", "velocityKp", "velocityKi"] },
    { id: "telemetry", type: "chart", label: "实时遥测", status: "online", channels: ["pitch", "leftSpeed", "rightSpeed", "voltage"] },
  ],
};

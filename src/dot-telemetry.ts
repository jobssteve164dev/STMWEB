import type { DeviceCapabilityManifest } from "./device-capabilities.js";

export type DotTelemetryChannel =
  | "balanceKp" | "balanceKi" | "balanceKd"
  | "velocityKp" | "velocityKi" | "velocityKd"
  | "voltage" | "averagePwm";

export interface DotTelemetryMeasurement {
  channel: DotTelemetryChannel;
  value: number;
}

const channels: Record<string, DotTelemetryChannel> = {
  bpy: "balanceKp",
  biy: "balanceKi",
  bdy: "balanceKd",
  spy: "velocityKp",
  siy: "velocityKi",
  sdy: "velocityKd",
  bat: "voltage",
  pwm: "averagePwm",
};

export const dotCapabilityManifest: DeviceCapabilityManifest = {
  schemaVersion: 1,
  device: {
    id: "dot-v1-ble",
    model: "DOT 平衡小车",
    firmwareVersion: "V1.0",
  },
  capabilities: [
    { id: "drive", type: "motor", label: "电机输出", status: "online", channels: ["averagePwm"] },
    { id: "battery", type: "battery", label: "电池电压", status: "online", channels: ["voltage"] },
    { id: "tuning", type: "controls", label: "平衡与速度参数", status: "online", channels: ["balanceKp", "balanceKi", "balanceKd", "velocityKp", "velocityKi", "velocityKd"] },
    { id: "telemetry", type: "chart", label: "实时遥测", status: "online", channels: ["averagePwm", "voltage"] },
  ],
};

export function parseDotTelemetryChunk(carry: string, chunk: string): {
  measurements: DotTelemetryMeasurement[];
  carry: string;
} {
  let input = `${carry}${chunk}`.replace(/[\r\n]/g, "");
  const measurements: DotTelemetryMeasurement[] = [];

  while (input.length > 0) {
    const tag = input.slice(0, 3);
    const channel = channels[tag];
    if (!channel) {
      input = input.slice(1);
      continue;
    }
    if (input.length < 8) return { measurements, carry: input };

    const valueText = input.slice(3, 8);
    const value = Number(valueText);
    if (Number.isFinite(value)) measurements.push({ channel, value });
    input = input.slice(8);
  }

  return { measurements, carry: "" };
}

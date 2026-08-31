import { parseCapabilityManifest, type DeviceCapabilityManifest } from "./device-capabilities.js";

export interface CardputerAdvScreenState { revision: number; background: string; lines: string[] }
export interface CardputerAdvKeysState { pressed: string[]; modifiers: string[] }
export interface CardputerAdvTwinState { screen: CardputerAdvScreenState; keys: CardputerAdvKeysState }
export type CardputerAdvStreamEvent = { type: "manifest"; manifest: DeviceCapabilityManifest } | { type: "screen"; screen: CardputerAdvScreenState } | { type: "keys"; keys: CardputerAdvKeysState } | { type: "battery"; voltage: number };

export const cardputerAdvKeyRows: string[][] = [
  ["` esc", "1 F1", "2 F2", "3 F3", "4 F4", "5 F5", "6 F6", "7 F7", "8 F8", "9 F9", "0 F10", "- F11", "= F12", "backspace del"],
  ["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
  ["fn", "shift", "a", "s", "d", "f", "g", "h", "j", "k", "l", "; ↑", "'", "enter"],
  ["ctrl", "opt", "alt", "z", "x", "c", "v", "b", "n", "m", ", ←", ". ↓", "/ →", "space"],
];
export const cardputerAdvCapabilityManifest: DeviceCapabilityManifest = {
  schemaVersion: 1,
  device: { id: "cardputer-adv", model: "M5Stack Cardputer ADV", firmwareVersion: "1.0.0" },
  capabilities: [
    { id: "screen", type: "display", label: "数字孪生屏幕", status: "online", channels: ["revision", "background", "lines"] },
    { id: "keyboard", type: "keyboard", label: "56 键键盘", status: "online", channels: ["pressed", "modifiers"] },
    { id: "battery", type: "battery", label: "电池电压", status: "online", channels: ["voltage"] },
  ],
};
export const cardputerAdvInitialTwin: CardputerAdvTwinState = {
  screen: { revision: 0, background: "#101820", lines: ["等待 Cardputer ADV 屏幕数据"] },
  keys: { pressed: [], modifiers: [] },
};

export function applyCardputerAdvEvent(twin: CardputerAdvTwinState, event: CardputerAdvStreamEvent): CardputerAdvTwinState {
  if (event.type === "screen") return { ...twin, screen: event.screen };
  if (event.type === "keys") return { ...twin, keys: event.keys };
  return twin;
}

export function parseCardputerAdvStream(carry: string, chunk: string): { events: CardputerAdvStreamEvent[]; carry: string } {
  const input = `${carry}${chunk}`;
  const lines = input.split(/\r?\n/);
  const nextCarry = lines.pop() ?? "";
  const events: CardputerAdvStreamEvent[] = [];
  for (const line of lines) {
    const screenMarker = "STMWEB_SCREEN:";
    const keysMarker = "STMWEB_KEYS:";
    const batteryMarker = "STMWEB_BATTERY:";
    try {
      const manifest = parseCapabilityManifest(`${line}\n`);
      if (manifest) {
        events.push({ type: "manifest", manifest });
      } else if (line.startsWith(screenMarker)) {
        const value = JSON.parse(line.slice(screenMarker.length)) as Partial<CardputerAdvScreenState>;
        if (Number.isInteger(value.revision) && typeof value.background === "string" && /^#[0-9a-f]{6}$/i.test(value.background)
          && Array.isArray(value.lines) && value.lines.length <= 8 && value.lines.every((item) => typeof item === "string" && item.length <= 80)) {
          events.push({ type: "screen", screen: { revision: value.revision!, background: value.background, lines: value.lines } });
        }
      } else if (line.startsWith(keysMarker)) {
        const value = JSON.parse(line.slice(keysMarker.length)) as Partial<CardputerAdvKeysState>;
        if (Array.isArray(value.pressed) && value.pressed.every((item) => typeof item === "string" && item.length <= 20)
          && Array.isArray(value.modifiers) && value.modifiers.every((item) => typeof item === "string" && item.length <= 20)) {
          events.push({ type: "keys", keys: { pressed: value.pressed, modifiers: value.modifiers } });
        }
      } else if (line.startsWith(batteryMarker)) {
        const value = JSON.parse(line.slice(batteryMarker.length)) as { voltage?: unknown };
        if (typeof value.voltage === "number" && Number.isFinite(value.voltage) && value.voltage >= 0 && value.voltage <= 6) {
          events.push({ type: "battery", voltage: value.voltage });
        }
      }
    } catch {
      // A malformed device frame is ignored without hiding subsequent complete frames.
    }
  }
  return { events, carry: nextCarry.slice(-4096) };
}

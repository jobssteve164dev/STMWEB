import assert from "node:assert/strict";
import test from "node:test";
import {
  demoCapabilityManifest,
  isDeviceCapabilityManifest,
  parseCapabilityManifest,
  recommendedComponents,
} from "../src/device-capabilities.js";

test("parses a versioned capability manifest from a device frame", () => {
  const frame = `noise\nSTMWEB_CAPS:${JSON.stringify(demoCapabilityManifest)}\r\n`;
  assert.deepEqual(parseCapabilityManifest(frame), demoCapabilityManifest);
});

test("rejects malformed and unknown capability manifests", () => {
  assert.equal(parseCapabilityManifest("STMWEB_CAPS:not-json"), null);
  assert.equal(isDeviceCapabilityManifest({ schemaVersion: 2, capabilities: [] }), false);
  assert.equal(isDeviceCapabilityManifest({
    schemaVersion: 1,
    device: { id: "a", model: "b", firmwareVersion: "c" },
    capabilities: [{ id: "x", type: "unsupported", label: "X", status: "online", channels: [] }],
  }), false);
});

test("recommendations exclude offline hardware and include session essentials", () => {
  const manifest = {
    ...demoCapabilityManifest,
    capabilities: demoCapabilityManifest.capabilities.map((capability) =>
      capability.type === "camera" ? { ...capability, status: "offline" as const } : capability,
    ),
  };
  const selected = recommendedComponents(manifest);
  assert.equal(selected.includes("camera"), false);
  assert.equal(selected.includes("orientation"), true);
  assert.equal(selected.includes("terminal"), true);
  assert.equal(selected.includes("events"), true);
  assert.equal(selected.includes("firmware"), true);
});

test("accepts display and keyboard capabilities reported by interactive hardware", () => {
  const manifest = parseCapabilityManifest(`STMWEB_CAPS:${JSON.stringify({
    schemaVersion: 1,
    device: { id: "cardputer-adv", model: "M5Stack Cardputer ADV", firmwareVersion: "1.0.0" },
    capabilities: [
      { id: "screen", type: "display", label: "数字孪生屏幕", status: "online", channels: ["screen"] },
      { id: "keyboard", type: "keyboard", label: "56 键键盘", status: "online", channels: ["pressed", "modifiers"] },
    ],
  })}\n`);
  assert.ok(manifest);
  assert.deepEqual(recommendedComponents(manifest).slice(0, 2), ["display", "keyboard"]);
});

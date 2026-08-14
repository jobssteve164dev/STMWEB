import assert from "node:assert/strict";
import test from "node:test";
import { dotCapabilityManifest, parseDotTelemetryChunk } from "../src/dot-telemetry.js";

test("parses the compact telemetry frames recorded from the real DOT car", () => {
  const realSessionFrames = "bpy120.0biy0.000bdy0.300spy120.0siy0.600sdy0.000bat0.000pwm-4867";
  const result = parseDotTelemetryChunk("", realSessionFrames);

  assert.deepEqual(result, {
    carry: "",
    measurements: [
      { channel: "balanceKp", value: 120 },
      { channel: "balanceKi", value: 0 },
      { channel: "balanceKd", value: 0.3 },
      { channel: "velocityKp", value: 120 },
      { channel: "velocityKi", value: 0.6 },
      { channel: "velocityKd", value: 0 },
      { channel: "voltage", value: 0 },
      { channel: "averagePwm", value: -4867 },
    ],
  });
  assert.deepEqual(dotCapabilityManifest.capabilities.map(({ type }) => type), ["motor", "battery", "controls", "chart"]);
});

test("reassembles a DOT frame split across Bluetooth notifications", () => {
  const first = parseDotTelemetryChunk("", "bat3.");
  const second = parseDotTelemetryChunk(first.carry, "847pwm-0012");

  assert.deepEqual(first, { measurements: [], carry: "bat3." });
  assert.deepEqual(second, {
    measurements: [
      { channel: "voltage", value: 3.847 },
      { channel: "averagePwm", value: -12 },
    ],
    carry: "",
  });
});

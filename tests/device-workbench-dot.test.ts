import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceWorkbench, type TelemetrySnapshot } from "../src/DeviceWorkbench.js";
import { dotCapabilityManifest } from "../src/dot-telemetry.js";

test("renders real DOT values in the accessory instruments", () => {
  Object.assign(globalThis, { React });
  const telemetry: TelemetrySnapshot = {
    pitch: 0, roll: 0, gyro: 0, leftSpeed: 0, rightSpeed: 0,
    leftPwm: 0, rightPwm: 0, voltage: 3.847, lineOffset: 0, lineAngle: 0,
    balanceKp: 120, balanceKi: 0, balanceKd: 0.3,
    velocityKp: 120, velocityKi: 0.6, velocityKd: 0, averagePwm: -4867,
  };
  const html = renderToStaticMarkup(React.createElement(DeviceWorkbench, {
    manifest: dotCapabilityManifest,
    selected: ["motor", "battery", "controls"],
    telemetry,
    isDemo: false,
    onChange: () => undefined,
  }));

  assert.match(html, /DOT 平衡小车/);
  assert.match(html, /平均 PWM/);
  assert.match(html, /4867/);
  assert.match(html, /3\.85 V/);
  assert.match(html, /平衡 Kd/);
  assert.match(html, /0\.300/);
  assert.match(html, /速度 Ki/);
  assert.match(html, /0\.600/);
});

import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { cardputerAdvCapabilityManifest, cardputerAdvInitialTwin } from "../src/cardputer-adv.js";
import { DeviceWorkbench } from "../src/DeviceWorkbench.js";

Object.assign(globalThis, { React });
const telemetry = { pitch: 0, roll: 0, gyro: 0, leftSpeed: 0, rightSpeed: 0, leftPwm: 0, rightPwm: 0, voltage: 3.9, lineOffset: 0, lineAngle: 0, balanceKp: 0, balanceKi: 0, balanceKd: 0, velocityKp: 0, velocityKi: 0, velocityKd: 0, averagePwm: 0 };

test("renders the Cardputer screen twin and complete keyboard map as workbench actions", () => {
  const html = renderToStaticMarkup(React.createElement(DeviceWorkbench, {
    manifest: cardputerAdvCapabilityManifest,
    selected: ["display", "keyboard"],
    telemetry,
    twin: { ...cardputerAdvInitialTwin, screen: { revision: 7, background: "#101820", lines: ["STMWEB", "Bluetooth ready"] }, keys: { pressed: ["fn", ";"], modifiers: ["fn"] } },
    isDemo: false, proAccess: true, onOpenFirmware: () => undefined, onChange: () => undefined,
  }));
  assert.match(html, /数字孪生屏幕/);
  assert.match(html, /240 × 135/);
  assert.match(html, /Bluetooth ready/);
  assert.match(html, /56 键映射/);
  assert.match(html, /data-key="fn"[^>]*class="[^"]*pressed/);
  assert.match(html, /data-key=";"[^>]*class="[^"]*pressed/);
  assert.match(html, /; ↑/);
  assert.match(html, /\/ →/);
});

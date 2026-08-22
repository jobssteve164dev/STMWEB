import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DotFirmwareFlashPanel } from "../src/DotFirmwareFlashPanel.js";
import { SwdFlashPanel } from "../src/InitialSwdFlashPanel.js";
import type { FirmwareVersionRecord } from "../src/db.js";

Object.assign(globalThis, { React });

function firmware(overrides: Partial<FirmwareVersionRecord>): FirmwareVersionRecord {
  return {
    id: crypto.randomUUID(),
    fileName: "firmware.bin",
    fileSize: 100,
    fileType: "BIN",
    sha256: "1".repeat(64),
    hardwareProfileId: "stmweb.dot-v1",
    artifactRole: "application",
    flashMethods: ["swd", "bluetooth"],
    flashSize: 64 * 1024,
    applicationBase: 0x08001000,
    applicationLimit: 0x0800fc00,
    runtimeVersion: "1",
    status: "verified",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

const completeImage = firmware({ id: "complete", fileName: "dot-complete.hex", fileType: "HEX", artifactRole: "complete-image", flashMethods: ["swd"] });
const application = firmware({ id: "application", fileName: "dot-application.bin" });
const draft = firmware({ id: "draft", fileName: "unverified.bin", hardwareProfileId: null, artifactRole: "unclassified", flashMethods: [], status: "draft" });

test("renders SWD as a long-term path and lists only compatible complete images", () => {
  const html = renderToStaticMarkup(React.createElement(SwdFlashPanel, { firmwareVersions: [completeImage, application, draft] }));
  assert.match(html, /长期有线烧录/);
  assert.match(html, /通过 SWD 安装、更新或恢复/);
  assert.match(html, /dot-complete\.hex/);
  assert.doesNotMatch(html, /dot-application\.bin/);
  assert.doesNotMatch(html, /unverified\.bin/);
});

test("lists only compatible application images in Bluetooth flashing", () => {
  const html = renderToStaticMarkup(React.createElement(DotFirmwareFlashPanel, {
    connection: null,
    voltage: 0,
    firmwareVersions: [completeImage, application, draft],
    onEvent: () => undefined,
  }));
  assert.match(html, /dot-application\.bin/);
  assert.doesNotMatch(html, /dot-complete\.hex/);
  assert.doesNotMatch(html, /unverified\.bin/);
});

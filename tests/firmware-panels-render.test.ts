import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DotFirmwareFlashPanel } from "../src/DotFirmwareFlashPanel.js";
import { CardputerAdvFirmwareFlashPanel } from "../src/CardputerAdvFirmwareFlashPanel.js";
import { BuildRunnerPanel } from "../src/BuildRunnerPanel.js";
import { SwdFlashPanel } from "../src/InitialSwdFlashPanel.js";
import { HardwareGatewayPanel } from "../src/HardwareGatewayPanel.js";
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
  assert.match(html, /DOT 完整稳定版（含 Bootloader，自动匹配）/);
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
  assert.match(html, /DOT 应用稳定版（保留 Bootloader，自动匹配）/);
  assert.match(html, /dot-application\.bin/);
  assert.doesNotMatch(html, /dot-complete\.hex/);
  assert.doesNotMatch(html, /unverified\.bin/);
});

test("offers only verified Cardputer ADV applications in wireless flashing", () => {
  const cardputerApplication = firmware({
    id: "cardputer-application",
    fileName: "cardputer-adv-ota.bin",
    hardwareProfileId: "stmweb.cardputer-adv",
    flashMethods: ["usb", "bluetooth"] as FirmwareVersionRecord["flashMethods"],
    flashSize: 8 * 1024 * 1024,
    applicationBase: 0x40000,
    applicationLimit: 0x3e0000,
  });
  const html = renderToStaticMarkup(React.createElement(CardputerAdvFirmwareFlashPanel, {
    connection: null,
    firmwareVersions: [application, cardputerApplication, draft],
    onEvent: () => undefined,
  }));
  assert.match(html, /Cardputer ADV 无线升级/);
  assert.match(html, /cardputer-adv-ota\.bin/);
  assert.doesNotMatch(html, /dot-application\.bin/);
  assert.doesNotMatch(html, /unverified\.bin/);
});

test("renders the phase C firmware composer using user actions", async () => {
  const html = renderToStaticMarkup(React.createElement(BuildRunnerPanel, { proAccess: true }));
  assert.match(html, /标准固件生成/);
  assert.match(html, /组装标准固件/);
  assert.match(html, /启动、恢复和校验模块由平台自动完成/);
  assert.match(html, /选择板卡后，即可配置这份固件的功能和连接方式/);
  assert.doesNotMatch(html, /固定适配与运行时版本/);
  const source = await readFile("src/BuildRunnerPanel.tsx", "utf8");
  assert.match(source, /首次安装、恢复和无线升级已经包含在这份固件中/);
});

test("does not ask Cardputer ADV users for an unrelated source archive", async () => {
  const source = await readFile("src/BuildRunnerPanel.tsx", "utf8");
  assert.match(source, /hardwareProfileId !== "stmweb\.cardputer-adv"/);
  const runner = await readFile("runner/stmweb-runner.mjs", "utf8");
  const cardputerBranch = runner.slice(runner.indexOf('job.hardwareProfileId === "stmweb.cardputer-adv"'), runner.indexOf("} else if (!hasCmake)"));
  assert.doesNotMatch(cardputerBranch, /STMWEB_SOURCE_ROOT/);
});

test("gives a new Cardputer owner an executable first USB install path", async () => {
  const source = await readFile("src/BuildRunnerPanel.tsx", "utf8");
  assert.match(source, /首次安装到 Cardputer ADV/);
  assert.match(source, /按住顶部 G0/);
  assert.match(source, /python -m esptool --chip esp32s3 write_flash 0x0/);
});

test("shows only named firmware downloads as primary actions and keeps technical files in details", async () => {
  const source = await readFile("src/BuildRunnerPanel.tsx", "utf8");
  assert.match(source, /下载完整固件/);
  assert.match(source, /下载应用固件/);
  assert.match(source, /<details className="build-artifact-details">/);
  assert.match(source, /artifact\.name/);
  assert.doesNotMatch(source, /artifact\.kind\.toUpperCase\(\)<\/a>/);
});

test("keeps the firmware list in a separate card below generation", async () => {
  const [app, styles] = await Promise.all([readFile("src/App.tsx", "utf8"), readFile("src/styles.css", "utf8")]);
  assert.match(app, /<BuildRunnerPanel[\s\S]*<section className="workbench-card firmware-library-card"/);
  assert.match(app, /id="firmware-library-heading">\{c\("固件列表", "Firmware list"\)\}/);
  assert.match(styles, /\.firmware-library-card\s*\{[\s\S]*?margin-top:\s*20px;/);
});

test("renders the hardware gateway as user actions without internal routing concepts", () => {
  const html = renderToStaticMarkup(React.createElement(HardwareGatewayPanel, { workspaceId: crypto.randomUUID(), onOpenSettings: () => undefined }));
  assert.match(html, /注册设备/);
  assert.match(html, /允许应用调用/);
  assert.match(html, /调用设备/);
  assert.match(html, /查看结果/);
  assert.doesNotMatch(html, /Provider|Consumer|Lease|南向|北向|租约/);
  assert.doesNotMatch(html, /speech\.say|motion\.play/);
});

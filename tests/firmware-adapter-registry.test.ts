import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFirmwareAdapterTarget, listFirmwareAdapterTargets, resolveFirmwareConfiguration, sameFirmwareComposition, verifyFirmwareComposition } from "../server/firmware-adapter-registry.js";

test("publishes the versioned firmware module catalog with each hardware target", () => {
  const compact = listFirmwareAdapterTargets().find((template) => template.target === "stm32f103c8");
  assert.ok(compact);
  assert.deepEqual(compact.foundationModules.map((module) => module.id), [
    "platform.boot-recovery", "platform.device-identity", "platform.debug-safety",
  ]);
  assert.equal(compact.capabilityModules.some((module) => module.id === "capability.motor-control"), true);
  assert.equal(compact.connectionModules.some((module) => module.id === "connection.swd" && module.required), true);
  assert.deepEqual(compact.capabilityModules.find((module) => module.id === "capability.motor-control")?.provides, [
    { port: "control.motor", version: "1" },
  ]);
});

test("resolves required modules, dependencies and selected flash methods on the server", () => {
  const registered = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103c8");
  assert.ok(registered);
  const configuration = resolveFirmwareConfiguration(registered.adapter, registered.target, ["capability.tuning", "connection.swd"]);
  assert.equal(configuration.schemaVersion, 2);
  assert.deepEqual(configuration.capabilityModules, ["capability.motor-control", "capability.tuning"]);
  assert.deepEqual(configuration.connectionModules, ["connection.swd"]);
  assert.deepEqual(configuration.flashMethods, ["swd"]);
  assert.deepEqual(configuration.portBindings, [{
    consumerId: "capability.tuning",
    requiredPort: "control.motor",
    providerId: "capability.motor-control",
    providedPort: "control.motor",
    version: "1",
  }]);
  assert.deepEqual(configuration.resourceBindings, []);
  assert.deepEqual(configuration.buildFeatures, []);
  assert.deepEqual(verifyFirmwareComposition(configuration), configuration);
  assert.throws(() => verifyFirmwareComposition({ ...configuration, capabilityModules: [] }), /摘要无效/);
  assert.throws(() => resolveFirmwareConfiguration(registered.adapter, registered.target, ["capability.unknown"]), /当前硬件不支持/);
});

test("accepts a composition after JSONB changes object key order", () => {
  const registered = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103cb");
  assert.ok(registered);
  const composition = resolveFirmwareConfiguration(registered.adapter, registered.target, ["connection.swd"]);
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reorder(item)]));
    }
    return value;
  };
  const reordered = reorder(composition);
  assert.deepEqual(verifyFirmwareComposition(reordered), reordered);
  assert.equal(sameFirmwareComposition(composition, verifyFirmwareComposition(reordered)), true);
});

test("binds the bluetooth component to a board UART and emits its real build feature", () => {
  const registered = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103c8");
  assert.ok(registered);
  const capabilities = ["capability.motor-control", "capability.battery", "capability.tuning", "capability.telemetry", "connection.swd"];
  const wired = resolveFirmwareConfiguration(registered.adapter, registered.target, capabilities);
  const bluetooth = resolveFirmwareConfiguration(registered.adapter, registered.target, [...capabilities, "connection.bluetooth"]);
  assert.deepEqual(wired.buildFeatures, []);
  assert.deepEqual(bluetooth.buildFeatures, ["dot.bluetooth-update"]);
  assert.deepEqual(wired.runtimeTransports, ["swd"]);
  assert.deepEqual(bluetooth.runtimeTransports, ["swd", "bluetooth-uart"]);
  assert.deepEqual(bluetooth.portBindings.find((binding) => binding.consumerId === "connection.bluetooth"), {
    consumerId: "connection.bluetooth",
    requiredPort: "platform.safe-stop",
    providerId: "platform.debug-safety",
    providedPort: "platform.safe-stop",
    version: "1",
  });
  assert.deepEqual(bluetooth.resourceBindings, [{
    componentId: "connection.bluetooth", role: "蓝牙连接", resourceId: "board.usart3", kind: "uart",
  }]);
  assert.notEqual(wired.compositionSha256, bluetooth.compositionSha256);
  assert.deepEqual(JSON.parse(readFileSync("tests/fixtures/dot-composition-wired.json", "utf8")), wired);
  assert.deepEqual(JSON.parse(readFileSync("tests/fixtures/dot-composition-bluetooth.json", "utf8")), bluetooth);
});

test("publishes Cardputer ADV as an ESP32-S3 board with display, keyboard and Bluetooth OTA", () => {
  const registered = getFirmwareAdapterTarget("stmweb.cardputer-adv", "1", "esp32s3fn8");
  assert.ok(registered);
  assert.equal(registered.adapter.buildProfile, "esp32s3-idf-v1");
  assert.equal(registered.target.flashSize, 8 * 1024 * 1024);
  assert.deepEqual(registered.target.deviceIds, [0x0009]);
  const configuration = resolveFirmwareConfiguration(registered.adapter, registered.target, [
    "capability.display-twin", "capability.keyboard-map", "connection.usb", "connection.bluetooth",
  ]);
  assert.deepEqual(configuration.capabilityModules, ["capability.display-twin", "capability.keyboard-map", "capability.battery"]);
  assert.deepEqual(configuration.connectionModules, ["connection.usb", "connection.bluetooth"]);
  assert.deepEqual(configuration.flashMethods, ["usb", "bluetooth"]);
  assert.deepEqual(configuration.runtimeTransports, ["usb-serial", "bluetooth-gatt"]);
  assert.deepEqual(configuration.buildFeatures, ["cardputer.display-twin", "cardputer.keyboard-map", "cardputer.bluetooth-ota"]);
  const requiredConfiguration = resolveFirmwareConfiguration(registered.adapter, registered.target, []);
  assert.deepEqual(requiredConfiguration.capabilityModules, ["capability.display-twin", "capability.keyboard-map", "capability.battery"]);
  assert.deepEqual(requiredConfiguration.connectionModules, ["connection.usb", "connection.bluetooth"]);
});

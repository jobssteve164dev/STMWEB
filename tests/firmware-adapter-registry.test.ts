import assert from "node:assert/strict";
import test from "node:test";
import { getFirmwareAdapterTarget, listFirmwareAdapterTargets, resolveFirmwareConfiguration } from "../server/firmware-adapter-registry.js";

test("publishes the versioned firmware module catalog with each hardware target", () => {
  const compact = listFirmwareAdapterTargets().find((template) => template.target === "stm32f103c8");
  assert.ok(compact);
  assert.deepEqual(compact.foundationModules.map((module) => module.id), [
    "platform.boot-recovery", "platform.device-identity", "platform.debug-safety",
  ]);
  assert.equal(compact.capabilityModules.some((module) => module.id === "capability.motor-control"), true);
  assert.equal(compact.connectionModules.some((module) => module.id === "connection.swd" && module.required), true);
});

test("resolves required modules, dependencies and selected flash methods on the server", () => {
  const registered = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103c8");
  assert.ok(registered);
  const configuration = resolveFirmwareConfiguration(registered.adapter, registered.target, ["capability.tuning", "connection.swd"]);
  assert.deepEqual(configuration.capabilityModules, ["capability.motor-control", "capability.tuning"]);
  assert.deepEqual(configuration.connectionModules, ["connection.swd"]);
  assert.deepEqual(configuration.flashMethods, ["swd"]);
  assert.throws(() => resolveFirmwareConfiguration(registered.adapter, registered.target, ["capability.unknown"]), /当前硬件不支持/);
});

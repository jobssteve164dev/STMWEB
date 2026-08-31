import assert from "node:assert/strict";
import test from "node:test";
import { registerGeneratedFirmwarePackage } from "../server/firmware-package-registration.js";

test("classifies an invalid generated package separately from control-plane failures", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => registerGeneratedFirmwarePackage(client as never, "11111111-1111-4111-8111-111111111111"),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "invalid_firmware_package",
  );
});

test("classifies an invalid persisted firmware composition as a package validation failure", async () => {
  const client = { query: async () => ({ rows: [{
    workspaceId: "workspace-1",
    hardwareProjectId: "22222222-2222-4222-8222-222222222222",
    createdBy: "user-1",
    name: "Cardputer",
    profile: "esp32s3-idf-v1",
    target: "esp32s3fn8",
    sourceName: "cardputer-adv-standard-firmware.zip",
    sourceSha256: "a".repeat(64),
    adapterVersion: "1",
    runtimeVersion: "1",
    hardwareProfileId: "stmweb.cardputer-adv",
    firmwareConfiguration: {},
  }] }) };
  await assert.rejects(
    () => registerGeneratedFirmwarePackage(client as never, "11111111-1111-4111-8111-111111111111"),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "invalid_firmware_package",
  );
});

test("does not classify database failures as invalid firmware packages", async () => {
  const databaseError = new Error("database unavailable");
  const client = { query: async () => { throw databaseError; } };
  await assert.rejects(
    () => registerGeneratedFirmwarePackage(client as never, "11111111-1111-4111-8111-111111111111"),
    (error: unknown) => error === databaseError && (error as Error & { code?: string }).code === undefined,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { FirmwareVersionRecord } from "../src/db.js";
import { createHash } from "node:crypto";
import { flashFirmwareOverUsb, validateUsbFirmware } from "../src/esp-usb-flasher.js";

function cardputerApplication(overrides: Partial<FirmwareVersionRecord> = {}): FirmwareVersionRecord {
  return {
    id: "cardputer-application",
    fileName: "cardputer_adv_ota.bin",
    fileSize: 1024,
    fileType: "BIN",
    sha256: "1".repeat(64),
    hardwareProfileId: "stmweb.cardputer-adv",
    artifactRole: "application",
    flashMethods: ["usb", "bluetooth"],
    flashSize: 8 * 1024 * 1024,
    applicationBase: 0x40000,
    applicationLimit: 0x3e0000,
    runtimeVersion: "1",
    status: "verified",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function cardputerComplete(bytes: Uint8Array, overrides: Partial<FirmwareVersionRecord> = {}): FirmwareVersionRecord {
  return cardputerApplication({
    id: "cardputer-complete",
    fileName: "cardputer_adv_complete.bin",
    fileSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    artifactRole: "complete-image",
    flashMethods: ["usb"],
    ...overrides,
  });
}

function esp32s3Image(payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(24);
  header.set([0xe9, 1, 2, 0]);
  new DataView(header.buffer).setUint32(4, 0x40370000, true);
  new DataView(header.buffer).setUint16(12, 9, true);
  const segment = new Uint8Array(8);
  new DataView(segment.buffer).setUint32(0, 0x3c000020, true);
  new DataView(segment.buffer).setUint32(4, payload.byteLength, true);
  const body = Uint8Array.from([...header, ...segment, ...payload]);
  const image = new Uint8Array((body.byteLength + 16) & ~15);
  image.set(body);
  image[image.byteLength - 1] = payload.reduce((checksum, byte) => checksum ^ byte, 0xef);
  return image;
}

function validCompleteImage(): Uint8Array {
  const marker = new TextEncoder().encode("STMWEB_ADAPTER:stmweb.cardputer-adv");
  const application = esp32s3Image(Uint8Array.from([...marker, ...new Uint8Array(96)]));
  const complete = new Uint8Array(0x40000 + application.byteLength).fill(0xff);
  complete.set(esp32s3Image(new Uint8Array([1, 2, 3, 4])), 0);
  complete.set([0xaa, 0x50, 0x01, 0x00], 0x8000);
  new DataView(complete.buffer).setUint32(0x8004, 0xe000, true);
  new DataView(complete.buffer).setUint32(0x8008, 0x2000, true);
  complete.set([0xaa, 0x50, 0x00, 0x10], 0x8020);
  new DataView(complete.buffer).setUint32(0x8024, 0x40000, true);
  new DataView(complete.buffer).setUint32(0x8028, 0x3a0000, true);
  complete.set([0xaa, 0x50, 0x00, 0x11], 0x8040);
  new DataView(complete.buffer).setUint32(0x8044, 0x3e0000, true);
  new DataView(complete.buffer).setUint32(0x8048, 0x3a0000, true);
  complete.set(application, 0x40000);
  return complete;
}

test("rejects USB application images because selecting the active OTA slot requires device state", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let requests = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serial: { requestPort: async () => { requests += 1; throw new Error("unexpected device request"); } } } });
  const bytes = new Uint8Array(256); bytes[0] = 0xe9;
  try {
    await assert.rejects(
      flashFirmwareOverUsb(cardputerApplication(), bytes, () => undefined),
      /完整镜像/,
    );
    assert.equal(requests, 0);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("rejects a complete image whose bytes do not match its verified digest", async () => {
  const bytes = new Uint8Array(0x40100).fill(0xff);
  await assert.rejects(validateUsbFirmware(cardputerComplete(bytes, { sha256: "0".repeat(64) }), bytes), /SHA-256/);
});

test("rejects a digest-matched complete image with an invalid ESP32-S3 layout", async () => {
  const bytes = new Uint8Array(0x40100).fill(0xff);
  await assert.rejects(validateUsbFirmware(cardputerComplete(bytes), bytes), /完整镜像/);
});

test("accepts a verified Cardputer ADV complete image before device access", async () => {
  const bytes = validCompleteImage();
  await validateUsbFirmware(cardputerComplete(bytes), bytes);
});

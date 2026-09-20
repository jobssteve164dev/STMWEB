import assert from "node:assert/strict";
import test from "node:test";
import type { FirmwareVersionRecord } from "../src/db.js";
import { createHash } from "node:crypto";
import { flashFirmwareOverUsb, prepareLocalUsbFirmware, readLocalUsbFirmware, usbFlashBaudRate, validateUsbFirmware } from "../src/esp-usb-flasher.js";

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

function esp32s3ImageWithHash(payload: Uint8Array): Uint8Array {
  const image = esp32s3Image(payload);
  image[23] = 1;
  const digest = createHash("sha256").update(image).digest();
  return Uint8Array.from([...image, ...digest]);
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

function validExternalCompleteImage(): Uint8Array {
  const application = esp32s3Image(new Uint8Array(128));
  const complete = new Uint8Array(0x10000 + application.byteLength).fill(0xff);
  complete.set(esp32s3Image(new Uint8Array([1, 2, 3, 4])), 0);
  complete.set([0xaa, 0x50, 0x01, 0x02], 0x8000);
  new DataView(complete.buffer).setUint32(0x8004, 0x9000, true);
  new DataView(complete.buffer).setUint32(0x8008, 0x5000, true);
  complete.set([0xaa, 0x50, 0x00, 0x00], 0x8020);
  new DataView(complete.buffer).setUint32(0x8024, 0x10000, true);
  new DataView(complete.buffer).setUint32(0x8028, 0x200000, true);
  complete.set(application, 0x10000);
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

test("accepts a structurally verified external Cardputer ADV image without a firmware-specific marker", async () => {
  const bytes = validExternalCompleteImage();
  await validateUsbFirmware(cardputerComplete(bytes, {
    fileName: "external-cardputer-firmware.bin",
    applicationBase: 0x10000,
    applicationLimit: 0x210000,
    runtimeVersion: null,
  }), bytes);
});

test("rejects an external image whose recorded application partition does not match its bytes", async () => {
  const bytes = validExternalCompleteImage();
  await assert.rejects(validateUsbFirmware(cardputerComplete(bytes, {
    fileName: "external-cardputer-firmware.bin",
    applicationBase: 0x10000,
    applicationLimit: 0x200000,
    runtimeVersion: null,
  }), bytes), /不是可验证的 Cardputer ADV 完整镜像/);
});

test("rejects an external image whose application exceeds its recorded partition", async () => {
  const bytes = validExternalCompleteImage();
  new DataView(bytes.buffer).setUint32(0x8028, 0x40, true);
  await assert.rejects(validateUsbFirmware(cardputerComplete(bytes, {
    fileName: "overflowing-application.bin",
    applicationBase: 0x10000,
    applicationLimit: 0x10040,
    runtimeVersion: null,
  }), bytes), /不是可验证的 Cardputer ADV 完整镜像/);
});

test("prepares a local complete image for USB flashing without server metadata", async () => {
  const module = await import("../src/esp-usb-flasher.js") as unknown as {
    prepareLocalUsbFirmware?: (fileName: string, bytes: Uint8Array) => Promise<FirmwareVersionRecord>;
  };
  assert.equal(typeof module.prepareLocalUsbFirmware, "function", "local USB firmware preparation is missing");
  const bytes = validExternalCompleteImage();
  const firmware = await module.prepareLocalUsbFirmware!("local-cardputer.bin", bytes);

  assert.equal(firmware.fileName, "local-cardputer.bin");
  assert.equal(firmware.hardwareProfileId, "stmweb.cardputer-adv");
  assert.equal(firmware.artifactRole, "complete-image");
  assert.deepEqual(firmware.flashMethods, ["usb"]);
  assert.equal(firmware.applicationBase, 0x10000);
  assert.equal(firmware.applicationLimit, 0x210000);
  assert.equal(firmware.sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("rejects a local image whose appended ESP32-S3 SHA-256 is corrupted even when XOR still matches", async () => {
  const application = esp32s3ImageWithHash(new Uint8Array(128));
  const complete = new Uint8Array(0x10000 + application.byteLength).fill(0xff);
  complete.set(esp32s3Image(new Uint8Array([1, 2, 3, 4])), 0);
  complete.set([0xaa, 0x50, 0x01, 0x02], 0x8000);
  new DataView(complete.buffer).setUint32(0x8004, 0x9000, true);
  new DataView(complete.buffer).setUint32(0x8008, 0x5000, true);
  complete.set([0xaa, 0x50, 0x00, 0x00], 0x8020);
  new DataView(complete.buffer).setUint32(0x8024, 0x10000, true);
  new DataView(complete.buffer).setUint32(0x8028, 0x200000, true);
  complete.set(application, 0x10000);
  await prepareLocalUsbFirmware("valid-hash.bin", complete);
  complete[0x10020] ^= 1;
  complete[0x10021] ^= 1;

  await assert.rejects(prepareLocalUsbFirmware("corrupted.bin", complete), /完整镜像/);
});

test("rejects an oversized local image before reading it into memory", async () => {
  let reads = 0;
  const file = {
    name: "too-large.bin",
    size: 8 * 1024 * 1024 + 1,
    async arrayBuffer() { reads += 1; return new ArrayBuffer(0); },
  };

  await assert.rejects(readLocalUsbFirmware(file), /8 MB/);
  assert.equal(reads, 0);
});

test("accepts a user-selected USB flashing baud rate and rejects unsafe values", () => {
  assert.equal(usbFlashBaudRate(115200), 115200);
  assert.equal(usbFlashBaudRate(460800), 460800);
  assert.equal(usbFlashBaudRate(921600), 921600);
  assert.equal(usbFlashBaudRate(748800), 748800);
  assert.throws(() => usbFlashBaudRate(0), /9600.*2000000/);
  assert.throws(() => usbFlashBaudRate(2000001), /9600.*2000000/);
  assert.throws(() => usbFlashBaudRate(460800.5), /整数/);
});

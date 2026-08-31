import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFirmwareAdapterTarget } from "../server/firmware-adapter-registry.js";
import { firmwareContainsPayload, inspectFirmwareArtifact, prepareFirmwareUpload } from "../server/firmware-artifact.js";

const cases = [
  ["dot_v1_compact_initial_swd.hex", "complete-image", 64 * 1024, ["swd"]],
  ["dot_v1_initial_swd.hex", "complete-image", 128 * 1024, ["swd"]],
  ["dot_v1_compact_application.bin", "application", 64 * 1024, ["swd", "bluetooth"]],
  ["dot_v1_application.bin", "application", 128 * 1024, ["swd", "bluetooth"]],
] as const;

for (const [fileName, role, flashSize, methods] of cases) {
  test(`classifies ${fileName} from its verified bytes`, () => {
    const content = readFileSync(`public/firmware/dot-v1/${fileName}`);
    const descriptor = inspectFirmwareArtifact(content, fileName);
    assert.equal(descriptor.hardwareProfileId, "stmweb.dot-v1");
    assert.equal(descriptor.artifactRole, role);
    assert.equal(descriptor.flashSize, flashSize);
    assert.deepEqual(descriptor.flashMethods, methods);
    assert.equal(descriptor.status, "verified");
  });
}

test("keeps an unsupported artifact as a non-flashable draft", () => {
  const descriptor = inspectFirmwareArtifact(new Uint8Array([1, 2, 3, 4]), "other.elf");
  assert.equal(descriptor.hardwareProfileId, null);
  assert.equal(descriptor.artifactRole, "unclassified");
  assert.deepEqual(descriptor.flashMethods, []);
  assert.equal(descriptor.status, "draft");
});

test("computes the stored digest from server-received bytes", () => {
  const content = readFileSync("public/firmware/dot-v1/dot_v1_compact_application.bin");
  const expected = createHash("sha256").update(content).digest("hex");
  assert.equal(prepareFirmwareUpload(content, "firmware.bin").sha256, expected);
  assert.throws(() => prepareFirmwareUpload(content, "firmware.bin", "0".repeat(64)), /实际文件内容不一致/);
});

test("finds an embedded configuration payload in application and complete images", () => {
  const registered = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103c8");
  assert.ok(registered);
  const payload = new TextEncoder().encode("STMWEB_CONFIG:test");
  const application = Buffer.concat([
    readFileSync("public/firmware/dot-v1/dot_v1_compact_application.bin"),
    payload,
  ]);
  assert.equal(firmwareContainsPayload(application, "application.bin", registered.target, payload), true);

  const source = readFileSync("public/firmware/dot-v1/dot_v1_compact_initial_swd.hex", "utf8");
  const data = [...payload];
  const address = 0xf000;
  const sum = data.reduce((total, value) => total + value, data.length + (address >> 8) + (address & 0xff));
  const checksum = (-sum) & 0xff;
  const record = `:${data.length.toString(16).padStart(2, "0")}${address.toString(16).padStart(4, "0")}00${Buffer.from(data).toString("hex")}${checksum.toString(16).padStart(2, "0")}`.toUpperCase();
  const complete = new TextEncoder().encode(source.replace(":00000001FF", `${record}\n:00000001FF`));
  assert.equal(firmwareContainsPayload(complete, "complete.hex", registered.target, payload), true);
});

test("classifies Cardputer ADV application and complete ESP32-S3 images from verified bytes", () => {
  const marker = new TextEncoder().encode("STMWEB_ADAPTER:stmweb.cardputer-adv");
  const espImage = (payload: Uint8Array) => {
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
    image[image.byteLength - 1] = payload.reduce((value, byte) => value ^ byte, 0xef);
    return image;
  };
  const application = espImage(Uint8Array.from([...marker, ...new Uint8Array(96)]));
  const expected = { hardwareProfileId: "stmweb.cardputer-adv", adapterVersion: "1", target: "esp32s3fn8" };
  const applicationDescriptor = inspectFirmwareArtifact(application, "cardputer_adv_ota.bin", expected);
  assert.equal(applicationDescriptor.hardwareProfileId, "stmweb.cardputer-adv");
  assert.equal(applicationDescriptor.artifactRole, "application");
  assert.deepEqual(applicationDescriptor.flashMethods, ["usb", "bluetooth"]);
  assert.equal(applicationDescriptor.applicationBase, 0x40000);

  const complete = new Uint8Array(0x40000 + application.byteLength).fill(0xff);
  complete.set(espImage(new Uint8Array([1, 2, 3, 4])), 0);
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
  const completeDescriptor = inspectFirmwareArtifact(complete, "cardputer_adv_complete.bin", expected);
  assert.equal(completeDescriptor.hardwareProfileId, "stmweb.cardputer-adv");
  assert.equal(completeDescriptor.artifactRole, "complete-image");
  assert.deepEqual(completeDescriptor.flashMethods, ["usb"]);

  const missingOtaSlot = complete.slice();
  missingOtaSlot.fill(0xff, 0x8040, 0x8060);
  assert.equal(inspectFirmwareArtifact(missingOtaSlot, "missing-ota-slot.bin", expected).artifactRole, "unclassified");

  const damaged = application.slice();
  damaged[damaged.byteLength - 1] ^= 0xff;
  assert.equal(inspectFirmwareArtifact(damaged, "damaged.bin", expected).artifactRole, "unclassified");

  const wrongChip = application.slice();
  new DataView(wrongChip.buffer).setUint16(12, 0, true);
  assert.equal(inspectFirmwareArtifact(wrongChip, "wrong-chip.bin", expected).artifactRole, "unclassified");
});

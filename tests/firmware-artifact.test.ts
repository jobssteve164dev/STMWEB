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

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectFirmwareArtifact, prepareFirmwareUpload } from "../server/firmware-artifact.js";

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

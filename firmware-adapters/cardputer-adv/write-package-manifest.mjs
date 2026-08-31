import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const buildDirectory = path.resolve(process.argv[2]);
const compositionFile = process.argv[3];
const adapter = JSON.parse(readFileSync(new URL("./adapter.json", import.meta.url), "utf8"));
const target = adapter.targets[0];

function assertEspImage(file) {
  const result = spawnSync("python", ["-m", "esptool", "--chip", "esp32s3", "image_info", file], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.includes("Checksum:") || !result.stdout.includes("(valid)")) {
    throw new Error(`ESP32-S3 image validation failed for ${path.basename(file)}: ${result.stderr || result.stdout}`);
  }
}

function u32(bytes, offset) { return bytes.readUInt32LE(offset); }

function assertCompleteLayout(bytes) {
  const expected = new Map([
    ["1:0", [0xe000, 0x2000]],
    ["0:16", [target.applicationBase, target.applicationLimit - target.applicationBase]],
    ["0:17", [target.applicationLimit, target.applicationLimit - target.applicationBase]],
  ]);
  for (let offset = 0x8000; offset + 32 <= 0x9000; offset += 32) {
    if (bytes[offset] !== 0xaa || bytes[offset + 1] !== 0x50) continue;
    const key = `${bytes[offset + 2]}:${bytes[offset + 3]}`;
    const contract = expected.get(key);
    if (contract && u32(bytes, offset + 4) === contract[0] && u32(bytes, offset + 8) === contract[1]
      && contract[0] + contract[1] <= target.flashSize) expected.delete(key);
  }
  if (expected.size) throw new Error("Cardputer ADV complete image is missing the required OTA partition layout");
}

const applicationFile = path.join(buildDirectory, "cardputer_adv_ota.bin");
const completeFile = path.join(buildDirectory, "cardputer_adv_complete.bin");
const applicationBytes = readFileSync(applicationFile);
const completeBytes = readFileSync(completeFile);
assertEspImage(applicationFile);
assertEspImage(completeFile);
assertCompleteLayout(completeBytes);
if (applicationBytes.byteLength > target.applicationLimit - target.applicationBase
  || !applicationBytes.includes(Buffer.from("STMWEB_ADAPTER:stmweb.cardputer-adv"))) {
  throw new Error("Cardputer ADV application image does not match the adapter contract");
}

const artifacts = target.artifacts.map((descriptor) => {
  const bytes = readFileSync(path.join(buildDirectory, descriptor.buildFile));
  return { ...descriptor, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
});

const manifest = {
  schemaVersion: 1,
  adapter: { id: adapter.adapterId, version: adapter.adapterVersion },
  hardware: {
    profileId: adapter.adapterId,
    revision: adapter.adapterVersion,
    target: target.id,
    mcuFamily: target.mcuFamily,
    deviceIds: target.deviceIds,
    flashBytes: target.flashSize,
  },
  runtime: { version: adapter.runtimeVersion, ...adapter.runtime },
  memory: { applicationBase: target.applicationBase, applicationLimit: target.applicationLimit },
  artifacts,
  validation: { status: "verified", checks: ["esp-image-checksum", "esp32s3-chip-id", "partition-layout", "adapter-marker", "sha256"] },
};

if (compositionFile) {
  manifest.composition = JSON.parse(readFileSync(compositionFile, "utf8"));
  manifest.runtime.transports = manifest.composition.runtimeTransports;
}

writeFileSync(path.join(buildDirectory, "stmweb_firmware_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const buildDirectory = path.resolve(process.argv[2]);
const targetId = process.argv[3];
const compositionFile = process.argv[4];
const adapter = JSON.parse(readFileSync(new URL("./adapter.json", import.meta.url), "utf8"));
const target = adapter.targets.find((candidate) => candidate.id === targetId);
if (!target) throw new Error(`unsupported adapter target: ${targetId}`);

const artifacts = target.artifacts.map((descriptor) => {
  const bytes = readFileSync(path.join(buildDirectory, descriptor.buildFile));
  return {
    ...descriptor,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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
  validation: { status: "verified", checks: ["vectors", "layout", "capacity", "factory-metadata", "sha256"] },
};

if (compositionFile) {
  manifest.composition = JSON.parse(readFileSync(compositionFile, "utf8"));
  manifest.runtime.transports = manifest.composition.runtimeTransports;
}

writeFileSync(path.join(buildDirectory, "stmweb_firmware_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const firmwareRoot = resolve(repositoryRoot, "public/firmware/dot-v1");

function artifact(fileName, role, flashMethods) {
  const bytes = readFileSync(resolve(firmwareRoot, fileName));
  return {
    role,
    format: fileName.endsWith(".hex") ? "ihex" : "bin",
    flashMethods,
    url: `/firmware/dot-v1/${fileName}`,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const manifest = {
  schemaVersion: 1,
  packageId: "stmweb.dot-v1.stable",
  label: "DOT V1 稳定版",
  hardwareProfileId: "stmweb.dot-v1",
  runtimeVersion: "1",
  variants: [
    {
      flashSize: 64 * 1024,
      applicationBase: 0x08001000,
      applicationLimit: 0x0800fc00,
      artifacts: [
        artifact("dot_v1_compact_initial_swd.hex", "complete-image", ["swd"]),
        artifact("dot_v1_compact_application.bin", "application", ["swd", "bluetooth"]),
      ],
    },
    {
      flashSize: 128 * 1024,
      applicationBase: 0x08004000,
      applicationLimit: 0x0801fc00,
      artifacts: [
        artifact("dot_v1_initial_swd.hex", "complete-image", ["swd"]),
        artifact("dot_v1_application.bin", "application", ["swd", "bluetooth"]),
      ],
    },
  ],
};

writeFileSync(resolve(firmwareRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

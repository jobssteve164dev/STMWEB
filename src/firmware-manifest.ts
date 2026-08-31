export type FirmwareArtifactRole = "complete-image" | "application";
export type FirmwareFlashMethod = "swd" | "usb" | "bluetooth";

interface DotFirmwareArtifact {
  role: FirmwareArtifactRole;
  format: "ihex" | "bin";
  flashMethods: FirmwareFlashMethod[];
  url: string;
  size: number;
  sha256: string;
}

interface DotFirmwareVariant {
  flashSize: number;
  applicationBase: number;
  applicationLimit: number;
  artifacts: DotFirmwareArtifact[];
}

interface DotFirmwareManifest {
  schemaVersion: 1;
  packageId: string;
  label: string;
  hardwareProfileId: "stmweb.dot-v1";
  runtimeVersion: string;
  variants: DotFirmwareVariant[];
}

export interface LoadedDotArtifact {
  flashSize: number;
  applicationBase: number;
  applicationLimit: number;
  bytes: Uint8Array;
}

const manifestUrl = "/firmware/dot-v1/manifest.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseManifest(value: unknown): DotFirmwareManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.hardwareProfileId !== "stmweb.dot-v1"
    || typeof value.packageId !== "string" || typeof value.label !== "string" || typeof value.runtimeVersion !== "string"
    || !Array.isArray(value.variants)) throw new Error("内置 DOT 固件清单无效");
  const variants = value.variants.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.flashSize !== "number" || typeof candidate.applicationBase !== "number"
      || typeof candidate.applicationLimit !== "number" || !Array.isArray(candidate.artifacts)) throw new Error("内置 DOT 固件清单包含无效目标");
    const artifacts = candidate.artifacts.map((artifact) => {
      if (!isRecord(artifact) || (artifact.role !== "complete-image" && artifact.role !== "application")
        || (artifact.format !== "ihex" && artifact.format !== "bin") || !Array.isArray(artifact.flashMethods)
        || !artifact.flashMethods.every((method) => method === "swd" || method === "usb" || method === "bluetooth")
        || typeof artifact.url !== "string" || !artifact.url.startsWith("/firmware/")
        || typeof artifact.size !== "number" || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
        throw new Error("内置 DOT 固件清单包含无效制品");
      }
      return artifact as unknown as DotFirmwareArtifact;
    });
    return { ...candidate, artifacts } as DotFirmwareVariant;
  });
  return { ...value, variants } as unknown as DotFirmwareManifest;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadBuiltInDotArtifacts(role: FirmwareArtifactRole, method: FirmwareFlashMethod): Promise<{ label: string; artifacts: LoadedDotArtifact[] }> {
  const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("无法读取内置 DOT 固件清单");
  const manifest = parseManifest(await manifestResponse.json());
  const artifacts = await Promise.all(manifest.variants.map(async (variant) => {
    const descriptor = variant.artifacts.find((artifact) => artifact.role === role && artifact.flashMethods.includes(method));
    if (!descriptor) throw new Error(`内置 DOT 固件缺少 ${variant.flashSize / 1024} KiB 兼容制品`);
    const response = await fetch(descriptor.url, { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取内置 DOT 固件制品");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== descriptor.size || await sha256(bytes) !== descriptor.sha256) throw new Error("内置 DOT 固件制品未通过完整性校验");
    return {
      flashSize: variant.flashSize,
      applicationBase: variant.applicationBase,
      applicationLimit: variant.applicationLimit,
      bytes,
    };
  }));
  return { label: manifest.label, artifacts };
}

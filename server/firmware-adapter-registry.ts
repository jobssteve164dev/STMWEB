import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const flashMethodSchema = z.enum(["swd", "bluetooth"]);
const artifactSchema = z.object({
  buildFile: z.string().min(1),
  role: z.enum(["complete-image", "application"]),
  format: z.enum(["ihex", "bin"]),
  flashMethods: z.array(flashMethodSchema).min(1),
});
const targetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mcuFamily: z.string().min(1),
  deviceIds: z.array(z.number().int().nonnegative()).min(1),
  flashSize: z.number().int().positive(),
  applicationBase: z.number().int().positive(),
  applicationLimit: z.number().int().positive(),
  applicationLinkerScript: z.string().min(1),
  bootloaderLinkerScript: z.string().min(1),
  deviceDefine: z.string().min(1),
  compactRuntime: z.boolean(),
  artifacts: z.array(artifactSchema).length(2),
});
const adapterSchema = z.object({
  schemaVersion: z.literal(1),
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  runtimeVersion: z.string().min(1),
  label: z.string().min(1),
  buildProfile: z.string().min(1),
  runtime: z.object({
    debugProtocol: z.string().min(1),
    bootProtocol: z.string().min(1),
    transports: z.array(z.string().min(1)).min(1),
  }),
  targets: z.array(targetSchema).min(1),
});

export type FirmwareAdapter = z.infer<typeof adapterSchema>;
export type FirmwareAdapterTarget = z.infer<typeof targetSchema>;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapters = [adapterSchema.parse(JSON.parse(readFileSync(path.join(repositoryRoot, "firmware-adapters/dot-v1/adapter.json"), "utf8")))];

export function listFirmwareAdapterTargets() {
  return adapters.flatMap((adapter) => adapter.targets.map((target) => ({
    hardwareProfileId: adapter.adapterId,
    adapterVersion: adapter.adapterVersion,
    runtimeVersion: adapter.runtimeVersion,
    adapterLabel: adapter.label,
    buildProfile: adapter.buildProfile,
    target: target.id,
    targetLabel: target.label,
    flashSize: target.flashSize,
    flashMethods: [...new Set(target.artifacts.flatMap((artifact) => artifact.flashMethods))],
  })));
}

export function getFirmwareAdapterTarget(hardwareProfileId: string, adapterVersion: string, targetId: string): { adapter: FirmwareAdapter; target: FirmwareAdapterTarget } | null {
  const adapter = adapters.find((candidate) => candidate.adapterId === hardwareProfileId && candidate.adapterVersion === adapterVersion);
  const target = adapter?.targets.find((candidate) => candidate.id === targetId);
  return adapter && target ? { adapter, target } : null;
}

export function allFirmwareAdapterTargets(): Array<{ adapter: FirmwareAdapter; target: FirmwareAdapterTarget }> {
  return adapters.flatMap((adapter) => adapter.targets.map((target) => ({ adapter, target })));
}

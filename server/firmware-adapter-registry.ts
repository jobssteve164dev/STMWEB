import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const flashMethodSchema = z.enum(["swd", "bluetooth"]);
const localizedTextSchema = z.object({ zh: z.string().min(1), en: z.string().min(1) });
const moduleBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  label: localizedTextSchema,
  description: localizedTextSchema,
  targets: z.array(z.string().min(1)).optional(),
  requires: z.array(z.string().min(1)).default([]),
  conflicts: z.array(z.string().min(1)).default([]),
});
const foundationModuleSchema = moduleBaseSchema.extend({ kind: z.literal("foundation") });
const capabilityModuleSchema = moduleBaseSchema.extend({ kind: z.literal("capability"), defaultEnabled: z.boolean() });
const connectionModuleSchema = moduleBaseSchema.extend({
  kind: z.literal("connection"),
  defaultEnabled: z.boolean(),
  required: z.boolean(),
  flashMethod: flashMethodSchema,
});
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
  buildDirectory: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  runtime: z.object({
    debugProtocol: z.string().min(1),
    bootProtocol: z.string().min(1),
    transports: z.array(z.string().min(1)).min(1),
  }),
  modules: z.object({
    foundation: z.array(foundationModuleSchema).min(1),
    capabilities: z.array(capabilityModuleSchema),
    connections: z.array(connectionModuleSchema).min(1),
  }),
  targets: z.array(targetSchema).min(1),
});

export type FirmwareAdapter = z.infer<typeof adapterSchema>;
export type FirmwareAdapterTarget = z.infer<typeof targetSchema>;
export type FirmwareModule = z.infer<typeof foundationModuleSchema> | z.infer<typeof capabilityModuleSchema> | z.infer<typeof connectionModuleSchema>;
export interface FirmwareConfiguration {
  schemaVersion: 1;
  foundationModules: string[];
  capabilityModules: string[];
  connectionModules: string[];
  flashMethods: Array<z.infer<typeof flashMethodSchema>>;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterRoot = path.join(repositoryRoot, "firmware-adapters");

export function loadFirmwareAdapters(root = adapterRoot): FirmwareAdapter[] {
  const loaded = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, "adapter.json")))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => adapterSchema.parse(JSON.parse(readFileSync(path.join(root, entry.name, "adapter.json"), "utf8"))));
  const identities = new Set<string>();
  for (const adapter of loaded) {
    const identity = `${adapter.adapterId}:${adapter.adapterVersion}`;
    if (identities.has(identity)) throw new Error(`固件适配器重复登记：${identity}`);
    identities.add(identity);
    const targetIds = new Set(adapter.targets.map((target) => target.id));
    const modules = [...adapter.modules.foundation, ...adapter.modules.capabilities, ...adapter.modules.connections];
    const moduleIds = new Set(modules.map((module) => module.id));
    if (moduleIds.size !== modules.length) throw new Error(`固件适配器 ${identity} 存在重复模块`);
    for (const module of modules) {
      if (module.targets?.some((target) => !targetIds.has(target))) throw new Error(`固件模块 ${module.id} 引用了未知目标`);
      if ([...module.requires, ...module.conflicts].some((moduleId) => !moduleIds.has(moduleId))) throw new Error(`固件模块 ${module.id} 引用了未知依赖`);
    }
  }
  if (!loaded.length) throw new Error("没有找到可用的固件适配器");
  return loaded;
}

const adapters = loadFirmwareAdapters();

function supportsTarget(module: FirmwareModule, targetId: string): boolean {
  return !module.targets || module.targets.includes(targetId);
}

export function resolveFirmwareConfiguration(
  adapter: FirmwareAdapter,
  target: FirmwareAdapterTarget,
  selectedModuleIds?: string[],
): FirmwareConfiguration {
  const available = [...adapter.modules.foundation, ...adapter.modules.capabilities, ...adapter.modules.connections]
    .filter((module) => supportsTarget(module, target.id));
  const byId = new Map(available.map((module) => [module.id, module]));
  const selectable = [...adapter.modules.capabilities, ...adapter.modules.connections].filter((module) => supportsTarget(module, target.id));
  const selected = new Set(selectedModuleIds ?? selectable.filter((module) => module.defaultEnabled).map((module) => module.id));
  for (const moduleId of selected) {
    const module = byId.get(moduleId);
    if (!module || module.kind === "foundation") throw new Error(`当前硬件不支持固件模块：${moduleId}`);
  }
  for (const module of adapter.modules.connections.filter((candidate) => candidate.required && supportsTarget(candidate, target.id))) selected.add(module.id);
  const queue = [...selected];
  while (queue.length) {
    const module = byId.get(queue.shift()!);
    if (!module) continue;
    for (const dependency of module.requires) {
      if (!byId.has(dependency)) throw new Error(`固件模块 ${module.id} 缺少当前硬件可用的依赖：${dependency}`);
      if (!selected.has(dependency)) { selected.add(dependency); queue.push(dependency); }
    }
  }
  for (const moduleId of selected) {
    const module = byId.get(moduleId)!;
    const conflict = module.conflicts.find((candidate) => selected.has(candidate));
    if (conflict) throw new Error(`固件模块 ${module.id} 与 ${conflict} 不能同时使用`);
  }
  const foundations = adapter.modules.foundation.filter((module) => supportsTarget(module, target.id)).map((module) => module.id);
  const capabilities = adapter.modules.capabilities.filter((module) => selected.has(module.id)).map((module) => module.id);
  const connections = adapter.modules.connections.filter((module) => selected.has(module.id)).map((module) => module.id);
  const flashMethods = adapter.modules.connections.filter((module) => selected.has(module.id)).map((module) => module.flashMethod);
  return { schemaVersion: 1, foundationModules: foundations, capabilityModules: capabilities, connectionModules: connections, flashMethods: [...new Set(flashMethods)] };
}

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
    foundationModules: adapter.modules.foundation.filter((module) => supportsTarget(module, target.id)),
    capabilityModules: adapter.modules.capabilities.filter((module) => supportsTarget(module, target.id)),
    connectionModules: adapter.modules.connections.filter((module) => supportsTarget(module, target.id)),
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

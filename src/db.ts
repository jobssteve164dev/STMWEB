export type SessionStatus = "recording" | "completed" | "interrupted";

export interface DebugSessionRecord {
  id: string;
  projectId: string;
  deviceId?: string;
  deviceName: string;
  connectionLabel: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  eventCount: number;
  isDemo: boolean;
}

export interface DebugEventRecord {
  id: string;
  sessionId: string;
  sequence: number;
  recordedAt: string;
  level: "info" | "success" | "warning" | "data";
  message: string;
  payload?: Record<string, number | string | boolean>;
}

export interface FirmwareVersionRecord {
  id: string;
  projectId?: string;
  workspaceId?: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  sha256: string;
  hardwareProfileId: string | null;
  artifactRole: "complete-image" | "application" | "unclassified";
  flashMethods: Array<"swd" | "usb" | "bluetooth">;
  flashSize: number | null;
  applicationBase: number | null;
  applicationLimit: number | null;
  runtimeVersion: string | null;
  status: "draft" | "verified" | "stable" | "retired";
  packageId?: string | null;
  packageName?: string | null;
  hardwareProjectName?: string | null;
  createdAt: string;
  blob?: Blob;
}

export interface DeviceRecord {
  id: string;
  workspaceId: string;
  name: string;
  model: string;
  board: string;
  clock: string;
  flash: string;
  location: string;
  version: string;
  note: string;
}

export type WorkbenchComponentId = DeviceCapabilityType;

export interface BuildRunnerRecord {
  id: string;
  name: string;
  status: "online" | "busy" | "offline";
  capabilities: {
    architecture?: string;
    backend?: string;
    environmentVersion?: string;
    firmwareCompositionVersion?: number;
    resourceLimits?: { cpuCores: number; memoryMb: number };
    supportedAdapterTargets?: Array<{ hardwareProfileId: string; adapterVersion: string; target: string }>;
    toolchains?: Array<{ id: string; version: string; targets: string[] }>;
  };
  currentJobId?: string;
  lastSeenAt?: string;
}

export interface BuildArtifactRecord {
  id: string;
  name: string;
  kind: string;
  sha256: string;
  size: number;
  artifactRole?: "complete-image" | "application" | null;
}

export interface FirmwareConfiguration {
  schemaVersion: 2;
  foundationModules: string[];
  capabilityModules: string[];
  connectionModules: string[];
  flashMethods: Array<"swd" | "usb" | "bluetooth">;
  runtimeTransports: string[];
  components: Array<{
    id: string;
    version: string;
    kind: "foundation" | "capability" | "connection";
    provides: Array<{ port: string; version: string }>;
    requires: Array<{ port: string; version: string; count: number }>;
    buildFeatures: string[];
  }>;
  portBindings: Array<{ consumerId: string; requiredPort: string; providerId: string; providedPort: string; version: string }>;
  resourceBindings: Array<{ componentId: string; role: string; resourceId: string; kind: string }>;
  buildFeatures: string[];
  compositionSha256: string;
}

export interface FirmwareModuleRecord {
  id: string;
  kind: "foundation" | "capability" | "connection";
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  requires: string[];
  conflicts: string[];
  version: string;
  provides: Array<{ port: string; version: string }>;
  requiresPorts: Array<{ port: string; version: string; count: number }>;
  resources: Array<{ kind: string; role: string; exclusive: boolean }>;
  buildFeatures: string[];
  defaultEnabled?: boolean;
  required?: boolean;
  flashMethod?: "swd" | "usb" | "bluetooth";
  runtimeTransport?: string;
}

export interface BuildJobRecord {
  id: string;
  runnerId: string;
  runnerName: string;
  name: string;
  profile: string;
  target: string;
  firmwareConfiguration?: FirmwareConfiguration;
  hardwareProjectId?: string;
  hardwareProjectName?: string;
  packageId?: string;
  packageStatus?: "verified" | "stable" | "retired";
  sourceName: string;
  sourceSha256: string;
  status: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  error?: string;
  createdAt: string;
  artifacts: BuildArtifactRecord[];
}

export interface HardwareProjectRecord {
  id: string;
  name: string;
  hardwareProfileId: string;
  adapterVersion: string;
  runtimeVersion: string;
  target: string;
  firmwareConfiguration: FirmwareConfiguration;
  status: "active" | "retired";
  createdAt: string;
}

export interface HardwareTemplateRecord {
  hardwareProfileId: string;
  adapterVersion: string;
  runtimeVersion: string;
  adapterLabel: string;
  buildProfile: string;
  target: string;
  targetLabel: string;
  flashSize: number;
  flashMethods: Array<"swd" | "usb" | "bluetooth">;
  foundationModules: FirmwareModuleRecord[];
  capabilityModules: FirmwareModuleRecord[];
  connectionModules: FirmwareModuleRecord[];
}

let activeWorkspaceId = "";
let debugWriteQueue: Promise<void> = Promise.resolve();

export function configureWorkspace(workspaceId: string) {
  activeWorkspaceId = workspaceId;
}

function workspaceId(): string {
  if (!activeWorkspaceId) throw new Error("工作区尚未就绪");
  return activeWorkspaceId;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || "服务器请求失败");
  return data as T;
}

function enqueueDebugWrite(operation: () => Promise<void>): Promise<void> {
  const result = debugWriteQueue.then(operation, operation);
  debugWriteQueue = result.catch(() => undefined);
  return result;
}

export async function saveSession(session: DebugSessionRecord): Promise<void> {
  await enqueueDebugWrite(async () => {
    await requestJson(`/api/sessions/${session.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...session, workspaceId: workspaceId() }),
    });
  });
}

export async function listSessions(): Promise<DebugSessionRecord[]> {
  const result = await requestJson<{ sessions: DebugSessionRecord[] }>(
    `/api/workspaces/${workspaceId()}/sessions`,
  );
  return result.sessions;
}

export async function saveEvent(event: DebugEventRecord): Promise<void> {
  await enqueueDebugWrite(async () => {
    await requestJson(`/api/sessions/${event.sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
  });
}

export async function listEvents(sessionId: string): Promise<DebugEventRecord[]> {
  const result = await requestJson<{ events: DebugEventRecord[] }>(`/api/sessions/${sessionId}/events`);
  return result.events;
}

export async function saveFirmwareVersion(file: File): Promise<FirmwareVersionRecord> {
  const form = new FormData();
  form.set("file", file, file.name);
  const result = await requestJson<{ firmware: FirmwareVersionRecord }>(
    `/api/workspaces/${workspaceId()}/firmware`,
    { method: "POST", body: form },
  );
  return result.firmware;
}

export async function listFirmwareVersions(): Promise<FirmwareVersionRecord[]> {
  const result = await requestJson<{ firmware: FirmwareVersionRecord[] }>(
    `/api/workspaces/${workspaceId()}/firmware`,
  );
  return result.firmware;
}

export async function loadFirmwareContent(firmwareId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/workspaces/${workspaceId()}/firmware/${encodeURIComponent(firmwareId)}/content`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || "无法读取固件内容");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function listDevices(): Promise<DeviceRecord[]> {
  const result = await requestJson<{ devices: DeviceRecord[] }>(
    `/api/workspaces/${workspaceId()}/devices`,
  );
  return result.devices;
}

export async function createDevice(
  device: Omit<DeviceRecord, "id" | "workspaceId">,
): Promise<DeviceRecord> {
  const result = await requestJson<{ device: DeviceRecord }>(
    `/api/workspaces/${workspaceId()}/devices`,
    { method: "POST", body: JSON.stringify(device) },
  );
  return result.device;
}

export async function loadWorkbenchPreference(profileKey: string): Promise<WorkbenchComponentId[] | null> {
  const result = await requestJson<{ selectedComponents: WorkbenchComponentId[] | null }>(
    `/api/workspaces/${workspaceId()}/workbench/${encodeURIComponent(profileKey)}`,
  );
  return result.selectedComponents;
}

export async function saveWorkbenchPreference(
  profileKey: string,
  selectedComponents: WorkbenchComponentId[],
): Promise<void> {
  await requestJson(`/api/workspaces/${workspaceId()}/workbench/${encodeURIComponent(profileKey)}`, {
    method: "PUT",
    body: JSON.stringify({ selectedComponents }),
  });
}

export async function listBuildRunners(): Promise<BuildRunnerRecord[]> {
  const result = await requestJson<{ runners: BuildRunnerRecord[] }>(`/api/workspaces/${workspaceId()}/runners`);
  return result.runners;
}

export async function listHardwareProjects(): Promise<HardwareProjectRecord[]> {
  const result = await requestJson<{ hardwareProjects: HardwareProjectRecord[] }>(`/api/workspaces/${workspaceId()}/hardware-projects`);
  return result.hardwareProjects;
}

export async function listHardwareTemplates(): Promise<HardwareTemplateRecord[]> {
  const result = await requestJson<{ templates: HardwareTemplateRecord[] }>(`/api/workspaces/${workspaceId()}/hardware-projects/templates`);
  return result.templates;
}

export async function createHardwareProject(input: { name: string; template: HardwareTemplateRecord; selectedModuleIds: string[] }): Promise<HardwareProjectRecord> {
  const result = await requestJson<{ hardwareProject: HardwareProjectRecord }>(`/api/workspaces/${workspaceId()}/hardware-projects`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      hardwareProfileId: input.template.hardwareProfileId,
      adapterVersion: input.template.adapterVersion,
      target: input.template.target,
      selectedModuleIds: input.selectedModuleIds,
    }),
  });
  return result.hardwareProject;
}

export async function createRunnerPairing(): Promise<{ code: string; expiresAt: string; command: string }> {
  return requestJson(`/api/workspaces/${workspaceId()}/runners/pairing`, { method: "POST", body: "{}" });
}

export async function listBuildJobs(): Promise<BuildJobRecord[]> {
  const result = await requestJson<{ builds: BuildJobRecord[] }>(`/api/workspaces/${workspaceId()}/builds`);
  return result.builds;
}

export async function createBuildJob(input: {
  runnerId: string;
  name: string;
  hardwareProjectId: string;
  source?: File;
}): Promise<{ id: string; sha256: string }> {
  const form = new FormData();
  form.set("runnerId", input.runnerId);
  form.set("name", input.name);
  form.set("hardwareProjectId", input.hardwareProjectId);
  if (input.source) form.set("source", input.source, input.source.name);
  return requestJson(`/api/workspaces/${workspaceId()}/builds`, { method: "POST", body: form });
}

export async function cancelBuildJob(jobId: string): Promise<void> {
  await requestJson(`/api/workspaces/${workspaceId()}/builds/${jobId}/cancel`, { method: "POST", body: "{}" });
}

export async function publishFirmwarePackage(packageId: string): Promise<void> {
  await requestJson(`/api/workspaces/${workspaceId()}/firmware-packages/${packageId}/stable`, { method: "POST", body: "{}" });
}

export function buildArtifactUrl(jobId: string, artifactId: string): string {
  return `/api/workspaces/${workspaceId()}/builds/${jobId}/artifacts/${artifactId}`;
}
import type { DeviceCapabilityType } from "./device-capabilities.js";

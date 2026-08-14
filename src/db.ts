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
  projectId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  sha256: string;
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

export type WorkbenchComponentId =
  | "orientation" | "camera" | "motor" | "battery" | "chart"
  | "terminal" | "controls" | "events" | "firmware";

let activeWorkspaceId = "";

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

export async function saveSession(session: DebugSessionRecord): Promise<void> {
  await requestJson(`/api/sessions/${session.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...session, workspaceId: workspaceId() }),
  });
}

export async function listSessions(): Promise<DebugSessionRecord[]> {
  const result = await requestJson<{ sessions: DebugSessionRecord[] }>(
    `/api/workspaces/${workspaceId()}/sessions`,
  );
  return result.sessions;
}

export async function saveEvent(event: DebugEventRecord): Promise<void> {
  await requestJson(`/api/sessions/${event.sessionId}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export async function listEvents(sessionId: string): Promise<DebugEventRecord[]> {
  const result = await requestJson<{ events: DebugEventRecord[] }>(`/api/sessions/${sessionId}/events`);
  return result.events;
}

export async function saveFirmwareVersion(version: FirmwareVersionRecord): Promise<FirmwareVersionRecord> {
  if (!version.blob) throw new Error("固件内容不可用");
  const form = new FormData();
  form.set("file", version.blob, version.fileName);
  form.set("sha256", version.sha256);
  form.set("fileType", version.fileType);
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

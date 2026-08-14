export type SessionStatus = "recording" | "completed" | "interrupted";

export interface DebugSessionRecord {
  id: string;
  projectId: string;
  deviceId: string;
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
  blob: Blob;
}

const DATABASE_NAME = "stmweb-prototype";
const DATABASE_VERSION = 1;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("浏览器本地存储失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("浏览器本地事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("浏览器本地事务被中止"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("sessions")) {
        database.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("events")) {
        const events = database.createObjectStore("events", { keyPath: "id" });
        events.createIndex("by-session", "sessionId", { unique: false });
      }
      if (!database.objectStoreNames.contains("versions")) {
        database.createObjectStore("versions", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开浏览器本地存储"));
  });
}

async function putRecord(storeName: string, record: unknown): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(record);
  await transactionDone(transaction);
  database.close();
}

async function listRecords<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const records = await requestResult(transaction.objectStore(storeName).getAll());
  await transactionDone(transaction);
  database.close();
  return records as T[];
}

export function saveSession(session: DebugSessionRecord): Promise<void> {
  return putRecord("sessions", session);
}

export async function listSessions(): Promise<DebugSessionRecord[]> {
  const sessions = await listRecords<DebugSessionRecord>("sessions");
  return sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function saveEvent(event: DebugEventRecord): Promise<void> {
  return putRecord("events", event);
}

export async function listEvents(sessionId: string): Promise<DebugEventRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction("events", "readonly");
  const index = transaction.objectStore("events").index("by-session");
  const events = await requestResult(index.getAll(IDBKeyRange.only(sessionId)));
  await transactionDone(transaction);
  database.close();
  return (events as DebugEventRecord[]).sort((left, right) => left.sequence - right.sequence);
}

export function saveFirmwareVersion(version: FirmwareVersionRecord): Promise<void> {
  return putRecord("versions", version);
}

export async function listFirmwareVersions(): Promise<FirmwareVersionRecord[]> {
  const versions = await listRecords<FirmwareVersionRecord>("versions");
  return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

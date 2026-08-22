#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const baseUrl = argument("base-url").replace(/\/$/, "");
const pairingCode = argument("code");
const providerName = argument("name", "通知设备");
const statePath = path.resolve(argument("state", ".stmweb-device-provider-state.json"));

if (!baseUrl) {
  console.error("用法：node stmweb-device-provider.mjs --base-url https://你的-STMWEB --code 配对码");
  process.exit(1);
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch { return {}; }
}

async function saveState(state) {
  const temporary = `${statePath}.next`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, statePath);
}

async function request(route, init = {}, credential) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

let state = await readState();
if (!state.credential) {
  if (!pairingCode) throw new Error("首次运行需要提供配对码");
  const exchanged = await request("/api/device/v1/enrollments/exchange", {
    method: "POST", body: JSON.stringify({ code: pairingCode, providerName }),
  });
  state = { ...state, credential: exchanged.credential, providerId: exchanged.providerId, completed: {} };
  await saveState(state);
}

const providerDeviceId = state.providerDeviceId ?? createHash("sha256").update(`${os.hostname()}:stmweb-notification-device`).digest("hex").slice(0, 24);
const registered = await request("/api/device/v1/devices", {
  method: "POST",
  body: JSON.stringify({ providerDeviceId, name: providerName, model: "notification-device-v1", location: os.hostname(), firmwareVersion: "demo-agent-1" }),
}, state.credential);
state.providerDeviceId = providerDeviceId;
state.deviceId = registered.device.id;
state.completed ??= {};
await saveState(state);

const manifest = {
  schemaVersion: 1,
  manifestVersion: "notification-device-1",
  device: { id: state.deviceId, model: "notification-device-v1", firmwareVersion: "demo-agent-1" },
  actions: [
    {
      name: "speech.say", label: "说话", description: "在设备端朗读一段文字",
      inputSchema: { type: "object", additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 500 } }, required: ["text"] },
      resultSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 0 } }, required: ["durationMs"] },
      defaultTimeoutMs: 15_000, maximumTimeoutMs: 30_000, interruptible: true, status: "online",
    },
    {
      name: "motion.play", label: "做动作", description: "执行设备已经支持的预设动作",
      inputSchema: { type: "object", additionalProperties: false, properties: { preset: { type: "string", enum: ["wake", "wave", "nod"] } }, required: ["preset"] },
      resultSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 0 } }, required: ["durationMs"] },
      defaultTimeoutMs: 10_000, maximumTimeoutMs: 20_000, interruptible: true, status: "online",
    },
  ],
};
await request(`/api/device/v1/devices/${state.deviceId}/capabilities`, { method: "PUT", body: JSON.stringify(manifest) }, state.credential);
console.log(`设备已连接：${registered.device.name}（${state.deviceId}）`);

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function report(operation, status, sequence, values = {}) {
  return request(`/api/device/v1/operations/${operation.id}/events`, {
    method: "POST",
    body: JSON.stringify({ leaseId: operation.leaseId, eventId: `${operation.id}:${status}:${sequence}`, sequence, status, payload: {}, ...values }),
  }, state.credential);
}

while (!stopping) {
  await request("/api/device/v1/heartbeat", { method: "POST", body: JSON.stringify({ deviceIds: [state.deviceId] }) }, state.credential);
  const leased = await request("/api/device/v1/operations/lease", { method: "POST", body: JSON.stringify({ waitMs: 20_000 }) }, state.credential);
  const operation = leased.operation;
  if (!operation) continue;
  let sequence = operation.nextEventSequence;
  try {
    if (operation.status === "leased") {
      await report(operation, "accepted", sequence++);
      await report(operation, "running", sequence++);
    } else if (operation.status === "accepted") {
      await report(operation, "running", sequence++);
    }
    if (operation.status === "cancelling") {
      await report(operation, "cancelled", sequence++);
      console.log(`调用已取消：${operation.id}`);
      continue;
    }
    const startedAt = Date.now();
    if (!state.completed[operation.id]) {
      state.completed[operation.id] = { durationMs: Date.now() - startedAt };
      await saveState(state);
      if (operation.action === "speech.say") console.log(`设备说：${operation.arguments.text}`);
      else if (operation.action === "motion.play") console.log(`设备动作：${operation.arguments.preset}`);
      else {
        delete state.completed[operation.id];
        await saveState(state);
        throw Object.assign(new Error("设备不支持这个动作"), { code: "action_not_supported" });
      }
    }
    await report(operation, "succeeded", sequence++, { result: state.completed[operation.id] });
    console.log(`调用已完成：${operation.id}`);
  } catch (error) {
    try {
      await report(operation, "failed", sequence, { errorCode: error.code || "device_execution_failed", errorMessage: error.message });
    } catch { /* The server keeps the operation unknown until this provider reconnects. */ }
    console.error(`调用未完成：${operation.id} · ${error.message}`);
  }
}

console.log("设备连接已停止");

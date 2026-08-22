import { Check, Clipboard, KeyRound, Loader2, Play, Plus, RadioTower, ShieldCheck, Square, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./i18n.js";

type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
};

interface GatewayAction {
  name: string;
  label: string;
  description?: string;
  inputSchema: JsonSchema;
  defaultTimeoutMs: number;
  status: "online" | "degraded" | "unavailable";
}

interface GatewayDevice {
  id: string;
  name: string;
  model: string;
  location: string;
  firmwareVersion: string;
  status: "online" | "offline";
  lastSeenAt?: string;
  manifest?: { actions: GatewayAction[] };
}

interface GatewayOperation {
  id: string;
  deviceId: string;
  deviceName: string;
  action: string;
  status: "queued" | "leased" | "accepted" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "expired";
  result?: Record<string, unknown>;
  error?: { code: string; message?: string } | null;
  createdAt: string;
}

interface GatewayConnection { id: string; name: string; scopes: string[] }
interface GatewayGrant { id: string; connectionId: string; deviceId: string; actions: string[]; connectionName: string; deviceName: string }
interface GatewayData { devices: GatewayDevice[]; operations: GatewayOperation[]; connections: GatewayConnection[]; grants: GatewayGrant[] }

const activeStatuses = new Set(["queued", "leased", "accepted", "running", "cancelling"]);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "设备操作没有完成");
  return body;
}

function defaultArguments(action?: GatewayAction): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(action?.inputSchema.properties ?? {})) {
    values[name] = schema.enum?.[0] ?? (schema.type === "boolean" ? false : schema.type === "integer" || schema.type === "number" ? schema.minimum ?? 0 : "");
  }
  return values;
}

function actionFieldLabel(name: string, isEnglish: boolean): string {
  const labels: Record<string, [string, string]> = {
    text: ["要说的内容", "Text to say"],
    preset: ["预设动作", "Preset action"],
  };
  return labels[name]?.[isEnglish ? 1 : 0] ?? name;
}

function actionOptionLabel(value: string, isEnglish: boolean): string {
  const labels: Record<string, [string, string]> = {
    wake: ["起身", "Wake"], wave: ["挥手", "Wave"], nod: ["点头", "Nod"],
  };
  return labels[value]?.[isEnglish ? 1 : 0] ?? value;
}

export function HardwareGatewayPanel({ workspaceId, onOpenSettings }: { workspaceId: string; onOpenSettings: () => void }) {
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [data, setData] = useState<GatewayData>({ devices: [], operations: [], connections: [], grants: [] });
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedActionName, setSelectedActionName] = useState("");
  const [argumentsValue, setArgumentsValue] = useState<Record<string, unknown>>({});
  const [pairingOpen, setPairingOpen] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [enrollment, setEnrollment] = useState<{ code: string; expiresAt: string } | null>(null);
  const [grantConnectionId, setGrantConnectionId] = useState("");
  const [grantDeviceId, setGrantDeviceId] = useState("");
  const [grantActions, setGrantActions] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const result = await request<GatewayData>(`/api/v1/workspaces/${workspaceId}/gateway`);
    setData(result);
    setSelectedDeviceId((current) => current && result.devices.some((device) => device.id === current) ? current : result.devices[0]?.id ?? "");
    setGrantDeviceId((current) => current && result.devices.some((device) => device.id === current) ? current : result.devices[0]?.id ?? "");
    setGrantConnectionId((current) => current && result.connections.some((connection) => connection.id === current) ? current : result.connections[0]?.id ?? "");
  }, [workspaceId]);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : c("设备暂时无法读取", "Devices are temporarily unavailable"))); }, [load, isEnglish]);
  useEffect(() => {
    if (!data.operations.some((operation) => activeStatuses.has(operation.status))) return;
    const interval = window.setInterval(() => void load().catch(() => undefined), 2_000);
    return () => window.clearInterval(interval);
  }, [data.operations, load]);

  const selectedDevice = data.devices.find((device) => device.id === selectedDeviceId);
  const availableActions = selectedDevice?.manifest?.actions.filter((action) => action.status !== "unavailable") ?? [];
  const availableActionKey = availableActions.map((action) => `${action.name}:${action.status}`).join("|");
  const selectedAction = availableActions.find((action) => action.name === selectedActionName) ?? availableActions[0];
  const grantDevice = data.devices.find((device) => device.id === grantDeviceId);
  const pairingCommand = enrollment
    ? `curl -fsS ${window.location.origin}/device/stmweb-device-provider.mjs -o stmweb-device-provider.mjs && node stmweb-device-provider.mjs --base-url ${window.location.origin} --code ${enrollment.code}`
    : "";

  useEffect(() => {
    const nextName = availableActions[0]?.name ?? "";
    setSelectedActionName(nextName);
    setArgumentsValue(defaultArguments(availableActions[0]));
  }, [selectedDeviceId, availableActionKey]);

  async function perform(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try { await work(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : c("操作没有完成", "The action did not complete")); }
    finally { setBusy(""); }
  }

  const statusLabel = (status: GatewayOperation["status"]) => ({
    queued: c("正在发送给设备", "Sending to device"), leased: c("正在发送给设备", "Sending to device"), accepted: c("设备已收到", "Device received it"),
    running: c("设备正在执行", "Device is running"), cancelling: c("正在停止", "Stopping"), succeeded: c("已完成", "Completed"),
    failed: c("设备未完成", "Not completed"), cancelled: c("已取消", "Cancelled"), expired: c("等待时间已过，本次未执行", "Wait expired; not executed"),
  }[status]);
  const operationActionLabel = (operation: GatewayOperation) => data.devices
    .find((device) => device.id === operation.deviceId)?.manifest?.actions
    .find((action) => action.name === operation.action)?.label ?? c("设备动作", "Device action");

  return (
    <section className="page-section gateway-page" aria-labelledby="gateway-heading">
      <div className="page-heading"><div><span className="panel-kicker">{c("远程设备", "Remote devices")}</span><h1 id="gateway-heading">{c("硬件网关", "Hardware Gateway")}</h1><p>{c("让联网设备主动连接，在网页或获准的应用中调用它，并看到真实执行结果。", "Let connected devices come online, call them from the web or an approved app, and see the real result.")}</p></div><button className="primary-button" type="button" onClick={() => setPairingOpen((value) => !value)}><Plus size={17} />{c("注册设备", "Register Device")}</button></div>
      {error ? <div className="api-error" role="alert">{error}</div> : null}

      {pairingOpen ? <section className="gateway-enrollment" aria-labelledby="gateway-enrollment-heading">
        <div><span className="gateway-step">1</span><div><h2 id="gateway-enrollment-heading">{c("连接这台设备", "Connect this device")}</h2><p>{c("给这台设备连接起一个容易识别的名字，然后在设备电脑上运行配对命令。", "Name this device connection, then run the pairing command on the device computer.")}</p></div></div>
        {!enrollment ? <form onSubmit={(event) => { event.preventDefault(); void perform("enroll", async () => {
          const result = await request<{ enrollment: { code: string; expiresAt: string } }>(`/api/v1/workspaces/${workspaceId}/device-enrollments`, { method: "POST", body: JSON.stringify({ providerName }) });
          setEnrollment(result.enrollment); setCopied(false);
        }); }}><label><span>{c("设备连接名称", "Device connection name")}</span><input value={providerName} onChange={(event) => setProviderName(event.target.value)} required maxLength={160} placeholder={c("例如：书房机器狗", "e.g. Study Robot Dog")} /></label><button className="primary-button" type="submit" disabled={busy === "enroll"}>{busy === "enroll" ? <Loader2 className="spinning" size={17} /> : <KeyRound size={17} />}{c("生成配对命令", "Create Pairing Command")}</button></form> : <div className="pairing-result" role="status"><div><strong>{c("在设备电脑上运行", "Run on the device computer")}</strong><span>{c(`配对码 ${enrollment.code}，10 分钟内有效`, `Pairing code ${enrollment.code}, valid for 10 minutes`)}</span></div><code>{pairingCommand}</code><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(pairingCommand).then(() => setCopied(true))}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? c("已复制", "Copied") : c("复制命令", "Copy Command")}</button></div>}
      </section> : null}

      <div className="gateway-layout">
        <section className="gateway-devices" aria-labelledby="gateway-devices-heading"><div className="gateway-section-heading"><div><span className="panel-kicker">{c("我的设备", "My devices")}</span><h2 id="gateway-devices-heading">{c("可远程调用", "Ready to call")}</h2></div><span>{data.devices.length}</span></div>
          {data.devices.length ? <div className="gateway-device-list">{data.devices.map((device) => <button key={device.id} type="button" className={selectedDeviceId === device.id ? "gateway-device selected" : "gateway-device"} onClick={() => setSelectedDeviceId(device.id)}><span className={device.status === "online" ? "gateway-device-icon online" : "gateway-device-icon"}>{device.status === "online" ? <RadioTower size={20} /> : <WifiOff size={20} />}</span><span><strong>{device.name}</strong><small>{device.model}{device.location ? ` · ${device.location}` : ""}</small></span><span className={device.status === "online" ? "state-pill online" : "state-pill"}><span />{device.status === "online" ? c("在线", "Online") : c("离线", "Offline")}</span></button>)}</div> : <div className="gateway-empty"><RadioTower size={26} /><strong>{c("还没有远程设备", "No remote devices yet")}</strong><p>{c("注册后，设备会主动连接，不需要开放公网端口。", "Once registered, the device connects out without opening a public port.")}</p><button className="secondary-button" type="button" onClick={() => setPairingOpen(true)}>{c("注册第一台设备", "Register First Device")}</button></div>}
        </section>

        <section className="gateway-call" aria-labelledby="gateway-call-heading"><div className="gateway-section-heading"><div><span className="panel-kicker">{c("调用设备", "Call device")}</span><h2 id="gateway-call-heading">{selectedDevice?.name ?? c("选择一台设备", "Choose a device")}</h2></div></div>
          {selectedDevice && selectedAction ? <form onSubmit={(event) => { event.preventDefault(); void perform("call", async () => {
            await request(`/api/v1/workspaces/${workspaceId}/devices/${selectedDevice.id}/operations`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: selectedAction.name, arguments: argumentsValue, queueIfOffline: true }) });
          }); }}>
            <label><span>{c("要做什么", "Action")}</span><select value={selectedAction.name} onChange={(event) => { const action = availableActions.find((item) => item.name === event.target.value); setSelectedActionName(event.target.value); setArgumentsValue(defaultArguments(action)); }}>{availableActions.map((action) => <option key={action.name} value={action.name}>{action.label}</option>)}</select><small>{selectedAction.description}</small></label>
            {Object.entries(selectedAction.inputSchema.properties ?? {}).map(([name, schema]) => <label key={name}><span>{actionFieldLabel(name, isEnglish)}{selectedAction.inputSchema.required?.includes(name) ? " *" : ""}</span>{schema.enum ? <select value={String(argumentsValue[name] ?? "")} onChange={(event) => setArgumentsValue((current) => ({ ...current, [name]: event.target.value }))}>{schema.enum.map((item) => <option key={item} value={item}>{actionOptionLabel(item, isEnglish)}</option>)}</select> : schema.type === "boolean" ? <input type="checkbox" checked={Boolean(argumentsValue[name])} onChange={(event) => setArgumentsValue((current) => ({ ...current, [name]: event.target.checked }))} /> : <input type={schema.type === "integer" || schema.type === "number" ? "number" : "text"} min={schema.minimum} max={schema.maximum} required={selectedAction.inputSchema.required?.includes(name)} value={String(argumentsValue[name] ?? "")} onChange={(event) => setArgumentsValue((current) => ({ ...current, [name]: schema.type === "integer" || schema.type === "number" ? Number(event.target.value) : event.target.value }))} />}</label>)}
            {selectedDevice.status === "offline" ? <p className="gateway-offline-note"><WifiOff size={16} />{c("设备离线，操作会短暂等待；过期后不会补执行。", "The device is offline. The action waits briefly and will not run after expiry.")}</p> : null}
            <button className="primary-button" type="submit" disabled={busy === "call"}>{busy === "call" ? <Loader2 className="spinning" size={17} /> : <Play size={17} />}{busy === "call" ? c("正在发送", "Sending…") : c("调用设备", "Call Device")}</button>
          </form> : <div className="gateway-empty compact"><p>{selectedDevice ? c("设备还没有声明可调用动作。", "This device has not declared callable actions yet.") : c("先注册并选择一台设备。", "Register and select a device first.")}</p></div>}
        </section>
      </div>

      <section className="gateway-grants" aria-labelledby="gateway-grants-heading"><div className="gateway-section-heading"><div><span className="panel-kicker">{c("允许应用调用", "Allow an app")}</span><h2 id="gateway-grants-heading">{c("选择应用、设备和动作", "Choose an app, device and actions")}</h2></div></div>
        {data.connections.length && data.devices.length ? <form onSubmit={(event) => { event.preventDefault(); void perform("grant", async () => { await request(`/api/v1/workspaces/${workspaceId}/device-grants`, { method: "POST", body: JSON.stringify({ connectionId: grantConnectionId, deviceId: grantDeviceId, actions: grantActions }) }); }); }}><label><span>{c("应用", "App")}</span><select value={grantConnectionId} onChange={(event) => setGrantConnectionId(event.target.value)}>{data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label><label><span>{c("设备", "Device")}</span><select value={grantDeviceId} onChange={(event) => { setGrantDeviceId(event.target.value); setGrantActions([]); }}>{data.devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><fieldset><legend>{c("允许的动作", "Allowed actions")}</legend>{(grantDevice?.manifest?.actions ?? []).map((action) => <label key={action.name}><input type="checkbox" checked={grantActions.includes(action.name)} onChange={(event) => setGrantActions((current) => event.target.checked ? [...current, action.name] : current.filter((item) => item !== action.name))} />{action.label}</label>)}</fieldset><button className="secondary-button" type="submit" disabled={!grantActions.length || busy === "grant"}>{busy === "grant" ? <Loader2 className="spinning" size={16} /> : <ShieldCheck size={16} />}{c("保存允许范围", "Save Access")}</button></form> : <div className="gateway-empty compact"><p>{data.devices.length ? c("先在设置中创建一个 API 连接，再允许它调用这台设备。", "Create an API connection in Settings, then allow it to call this device.") : c("设备注册后，可以在这里允许应用调用指定动作。", "After registering a device, allow an app to call specific actions here.")}</p>{data.devices.length ? <button className="secondary-button" type="button" onClick={onOpenSettings}>{c("前往设置", "Open Settings")}</button> : null}</div>}
        {data.grants.length ? <div className="grant-list">{data.grants.map((grant) => <div key={grant.id}><ShieldCheck size={17} /><span>{c(`允许“${grant.connectionName}”调用“${grant.deviceName}”`, `Allow “${grant.connectionName}” to call “${grant.deviceName}”`)}</span><small>{grant.actions.map((name) => data.devices.find((device) => device.id === grant.deviceId)?.manifest?.actions.find((action) => action.name === name)?.label ?? name).join("、")}</small></div>)}</div> : null}
      </section>

      <section className="gateway-history" aria-labelledby="gateway-history-heading"><div className="gateway-section-heading"><div><span className="panel-kicker">{c("查看结果", "Results")}</span><h2 id="gateway-history-heading">{c("最近调用", "Recent calls")}</h2></div></div>
        {data.operations.length ? <ol>{data.operations.map((operation) => <li key={operation.id}><span className={`operation-state ${operation.status}`}>{activeStatuses.has(operation.status) ? <Loader2 className="spinning" size={16} /> : operation.status === "succeeded" ? <Check size={16} /> : <Square size={15} />}{statusLabel(operation.status)}</span><div><strong>{operation.deviceName}</strong><span>{operationActionLabel(operation)}</span></div><time>{new Date(operation.createdAt).toLocaleString(locale)}</time>{operation.error ? <small>{operation.error.message || operation.error.code}</small> : null}{activeStatuses.has(operation.status) ? <button className="text-button" type="button" disabled={busy === operation.id} onClick={() => void perform(operation.id, () => request(`/api/v1/workspaces/${workspaceId}/device-operations/${operation.id}/cancel`, { method: "POST", body: "{}" }))}>{c("取消", "Cancel")}</button> : null}</li>)}</ol> : <div className="gateway-empty compact"><p>{c("调用设备后，这里会显示设备收到、执行和完成的真实状态。", "After calling a device, its received, running and completed states appear here.")}</p></div>}
      </section>
    </section>
  );
}

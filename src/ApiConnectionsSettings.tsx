import { Check, Clipboard, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ApiScope = "devices:read" | "devices:control" | "debug:read" | "debug:execute" |
  "runners:read" | "runners:manage" | "builds:read" | "builds:create" | "builds:cancel" | "artifacts:read";

interface ApiConnection {
  id: string;
  name: string;
  purpose: string;
  scopes: ApiScope[];
  credentialHint: string;
  status: "active" | "revoked";
  createdAt: string;
  rotatedAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface ApiActivity {
  id: string;
  connectionId: string;
  action: string;
  outcome: "succeeded" | "failed";
  occurredAt: string;
}

const scopeGroups: Array<{ id: ApiScope; label: string }> = [
  { id: "devices:read", label: "查看设备" },
  { id: "devices:control", label: "登记设备" },
  { id: "debug:read", label: "查看调试记录" },
  { id: "debug:execute", label: "写入调试记录" },
  { id: "runners:read", label: "查看编译算力" },
  { id: "runners:manage", label: "接入编译算力" },
  { id: "builds:read", label: "查看固件构建" },
  { id: "builds:create", label: "创建固件构建" },
  { id: "builds:cancel", label: "取消固件构建" },
  { id: "artifacts:read", label: "下载构建制品" },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/api-connections${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "API 连接操作未完成");
  return body;
}

export function ApiConnectionsSettings({ accountEmail }: { accountEmail: string }) {
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [activity, setActivity] = useState<ApiActivity[]>([]);
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const result = await request<{ connections: ApiConnection[]; recentActivity: ApiActivity[] }>("/");
    setConnections(result.connections);
    setActivity(result.recentActivity);
  }, []);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "API 连接暂时无法读取")); }, [load]);

  async function perform(action: () => Promise<{ credential?: string } | unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await action() as { credential?: string };
      if (result.credential) { setCredential(result.credential); setCopied(false); }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作没有完成");
    } finally { setBusy(false); }
  }

  return (
    <section className="page-section api-settings" aria-labelledby="api-settings-heading">
      <div className="page-heading"><div><span className="panel-kicker">账户设置</span><h1 id="api-settings-heading">API 连接</h1><p>把你的硬件工作台接到自己信任的工具。每个连接只代表当前账户，并且可以随时撤销。</p></div></div>
      {error ? <div className="api-error" role="alert">{error}</div> : null}
      <form className="api-connection-form" onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const data = new FormData(formElement);
        const scopes = scopeGroups.filter(({ id }) => data.get(id) === "on").map(({ id }) => id);
        void perform(async () => {
          const result = await request<{ credential: string }>("/", { method: "POST", body: JSON.stringify({ name: data.get("name"), purpose: data.get("purpose"), scopes }) });
          formElement.reset();
          return result;
        });
      }}>
        <div className="api-form-copy"><span><KeyRound size={17} />新连接</span><h2>连接你的调用工具</h2><p>为不同工具分别创建连接，之后可以单独轮换或撤销。</p></div>
        <label><span>连接名称</span><input name="name" required maxLength={120} placeholder="例如：我的硬件助手" /></label>
        <label><span>用途说明</span><input name="purpose" required maxLength={500} placeholder="例如：查看设备并发起固件构建" /></label>
        <fieldset><legend>允许它完成</legend>{scopeGroups.map((scope) => <label key={scope.id}><input name={scope.id} type="checkbox" defaultChecked />{scope.label}</label>)}</fieldset>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="spinning" size={17} /> : <KeyRound size={17} />}{busy ? "正在创建" : "创建 API 连接"}</button>
      </form>
      {credential ? <div className="credential-reveal" role="status"><div><strong>请现在保存凭证</strong><p>这是唯一一次显示。只交给你信任的调用工具；丢失后请轮换。</p></div><code>{credential}</code><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(credential).then(() => setCopied(true))}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "已复制" : "复制凭证"}</button><button className="text-button" type="button" onClick={() => setCredential(null)}>我已保存</button></div> : null}
      <div className="api-connection-list">{connections.length ? connections.map((connection) => <article key={connection.id} className={connection.status === "revoked" ? "revoked" : ""}>
        <header><div><span className={connection.status === "active" ? "state-pill online" : "state-pill"}><span />{connection.status === "active" ? "可用" : "已撤销"}</span><h3>{connection.name}</h3><p>{connection.purpose}</p></div><small>凭证尾号 · {connection.credentialHint}</small></header>
        <ul>{connection.scopes.map((scope) => <li key={scope}>{scopeGroups.find((item) => item.id === scope)?.label ?? scope}</li>)}</ul>
        <footer><span>{connection.lastUsedAt ? `最近使用 ${new Date(connection.lastUsedAt).toLocaleString("zh-CN")}` : `创建于 ${new Date(connection.createdAt).toLocaleString("zh-CN")}`}</span>{connection.status === "active" ? <div><button className="secondary-button" type="button" disabled={busy} onClick={() => { if (window.confirm("轮换后旧凭证会立即失效。确定继续吗？")) void perform(() => request(`/${connection.id}/rotate`, { method: "POST", body: "{}" })); }}><RefreshCw size={15} />轮换</button><button className="danger-button" type="button" disabled={busy} onClick={() => { if (window.confirm("撤销后这个工具会立即失去访问权限，已有设备、记录和构建不会被删除。")) void perform(() => request(`/${connection.id}/revoke`, { method: "POST", body: "{}" })); }}><Trash2 size={15} />撤销</button></div> : null}</footer>
      </article>) : <div className="empty-state"><span className="empty-icon"><KeyRound size={25} /></span><strong>还没有 API 连接</strong><p>创建后，你可以把凭证交给自己信任的调用工具。</p></div>}</div>
      <section className="api-activity"><h2>最近调用</h2>{activity.length ? <ol>{activity.map((item) => <li key={item.id}><span className={item.outcome}>{item.outcome === "succeeded" ? "成功" : "失败"}</span><strong>{connections.find((connection) => connection.id === item.connectionId)?.name ?? "已撤销连接"}</strong><small>{item.action} · {new Date(item.occurredAt).toLocaleString("zh-CN")}</small></li>)}</ol> : <p>调用工具使用连接后，这里会出现操作记录。</p>}</section>
      <p className="api-account-note"><ShieldCheck size={16} />这些连接属于 {accountEmail}，不能切换到其他账户，也不会获得你的登录密码。</p>
    </section>
  );
}

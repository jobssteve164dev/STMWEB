import { ArrowRight, Check, Clipboard, KeyRound, Loader2, LockKeyhole, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./i18n.js";

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

const scopeGroups: Array<{ id: ApiScope; zh: string; en: string }> = [
  { id: "devices:read", zh: "查看设备", en: "View devices" },
  { id: "devices:control", zh: "登记设备", en: "Register devices" },
  { id: "debug:read", zh: "查看调试记录", en: "View debugging records" },
  { id: "debug:execute", zh: "写入调试记录", en: "Write debugging records" },
  { id: "runners:read", zh: "查看编译算力", en: "View build runners" },
  { id: "runners:manage", zh: "接入编译算力", en: "Connect build runners" },
  { id: "builds:read", zh: "查看固件构建", en: "View firmware builds" },
  { id: "builds:create", zh: "创建固件构建", en: "Create firmware builds" },
  { id: "builds:cancel", zh: "取消固件构建", en: "Cancel firmware builds" },
  { id: "artifacts:read", zh: "下载构建制品", en: "Download build artefacts" },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/api-connections${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  const fallbackError = navigator.languages.some((language) => language.toLowerCase().startsWith("zh")) ? "API 连接操作未完成" : "The API connection action did not complete";
  if (!response.ok) throw new Error(body.error || fallbackError);
  return body;
}

export function ApiConnectionsSettings({ accountEmail, proAccess }: { accountEmail: string; proAccess: boolean }) {
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
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

  useEffect(() => {
    if (proAccess) void load().catch((reason) => setError(reason instanceof Error ? reason.message : c("API 连接暂时无法读取", "API connections are temporarily unavailable")));
  }, [isEnglish, load, proAccess]);

  async function perform(action: () => Promise<{ credential?: string } | unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await action() as { credential?: string };
      if (result.credential) { setCredential(result.credential); setCopied(false); }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("操作没有完成", "The action did not complete"));
    } finally { setBusy(false); }
  }

  return (
    <section className="page-section api-settings" aria-labelledby="api-settings-heading">
      <div className="page-heading"><div><span className="panel-kicker">{c("账户设置", "Account settings")}</span><h1 id="api-settings-heading">{c("API 连接", "API Connections")}</h1><p>{c("把你的硬件工作台接到自己信任的工具。每个连接只代表当前账户，并且可以随时撤销。", "Connect your hardware workbench to tools you trust. Each connection represents this account only and can be revoked at any time.")}</p></div></div>
      {!proAccess ? <div className="settings-pro-gate"><span><LockKeyhole size={22} /></span><div><strong>{c("API 自动化属于 Pro 计划", "API automation is included in Pro")}</strong><p>{c("你仍可免费使用浏览器连接、动态调试台和工程记录。升级后才能创建可轮换、可撤销的外部工具连接。", "Browser connectivity, the dynamic workbench and engineering records remain free. Upgrade to create rotatable and revocable external tool connections.")}</p></div><a className="primary-button" href="/plans">{c("比较计划", "Compare Plans")} <ArrowRight size={16} /></a></div> : null}
      {proAccess ? <>
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
        <div className="api-form-copy"><span><KeyRound size={17} />{c("新连接", "New connection")}</span><h2>{c("连接你的调用工具", "Connect a Tool")}</h2><p>{c("为不同工具分别创建连接，之后可以单独轮换或撤销。", "Create a separate connection for each tool so you can rotate or revoke it independently.")}</p></div>
        <label><span>{c("连接名称", "Connection name")}</span><input name="name" required maxLength={120} placeholder={c("例如：我的硬件助手", "e.g. My Hardware Assistant")} /></label>
        <label><span>{c("用途说明", "Purpose")}</span><input name="purpose" required maxLength={500} placeholder={c("例如：查看设备并发起固件构建", "e.g. View devices and start firmware builds")} /></label>
        <fieldset><legend>{c("允许它完成", "Allow this connection to")}</legend>{scopeGroups.map((scope) => <label key={scope.id}><input name={scope.id} type="checkbox" defaultChecked />{isEnglish ? scope.en : scope.zh}</label>)}</fieldset>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="spinning" size={17} /> : <KeyRound size={17} />}{busy ? c("正在创建", "Creating…") : c("创建 API 连接", "Create API Connection")}</button>
      </form>
      {credential ? <div className="credential-reveal" role="status"><div><strong>{c("请现在保存凭证", "Save this credential now")}</strong><p>{c("这是唯一一次显示。只交给你信任的调用工具；丢失后请轮换。", "This is the only time it will be shown. Share it only with a trusted tool; rotate it if lost.")}</p></div><code>{credential}</code><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(credential).then(() => setCopied(true))}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? c("已复制", "Copied") : c("复制凭证", "Copy Credential")}</button><button className="text-button" type="button" onClick={() => setCredential(null)}>{c("我已保存", "I've Saved It")}</button></div> : null}
      <div className="api-connection-list">{connections.length ? connections.map((connection) => <article key={connection.id} className={connection.status === "revoked" ? "revoked" : ""}>
        <header><div><span className={connection.status === "active" ? "state-pill online" : "state-pill"}><span />{connection.status === "active" ? c("可用", "Active") : c("已撤销", "Revoked")}</span><h3>{connection.name}</h3><p>{connection.purpose}</p></div><small>{c("凭证尾号", "Credential ending")} · {connection.credentialHint}</small></header>
        <ul>{connection.scopes.map((scope) => { const item = scopeGroups.find((candidate) => candidate.id === scope); return <li key={scope}>{item ? (isEnglish ? item.en : item.zh) : scope}</li>; })}</ul>
        <footer><span>{connection.lastUsedAt ? c(`最近使用 ${new Date(connection.lastUsedAt).toLocaleString(locale)}`, `Last used ${new Date(connection.lastUsedAt).toLocaleString(locale)}`) : c(`创建于 ${new Date(connection.createdAt).toLocaleString(locale)}`, `Created ${new Date(connection.createdAt).toLocaleString(locale)}`)}</span>{connection.status === "active" ? <div><button className="secondary-button" type="button" disabled={busy} onClick={() => { if (window.confirm(c("轮换后旧凭证会立即失效。确定继续吗？", "The old credential will stop working immediately. Continue?"))) void perform(() => request(`/${connection.id}/rotate`, { method: "POST", body: "{}" })); }}><RefreshCw size={15} />{c("轮换", "Rotate")}</button><button className="danger-button" type="button" disabled={busy} onClick={() => { if (window.confirm(c("撤销后这个工具会立即失去访问权限，已有设备、记录和构建不会被删除。", "This tool will immediately lose access. Existing devices, records and builds will not be deleted."))) void perform(() => request(`/${connection.id}/revoke`, { method: "POST", body: "{}" })); }}><Trash2 size={15} />{c("撤销", "Revoke")}</button></div> : null}</footer>
      </article>) : <div className="empty-state"><span className="empty-icon"><KeyRound size={25} /></span><strong>{c("还没有 API 连接", "No API connections yet")}</strong><p>{c("创建后，你可以把凭证交给自己信任的调用工具。", "Create one, then give the credential to a tool you trust.")}</p></div>}</div>
      <section className="api-activity"><h2>{c("最近调用", "Recent Activity")}</h2>{activity.length ? <ol>{activity.map((item) => <li key={item.id}><span className={item.outcome}>{item.outcome === "succeeded" ? c("成功", "Succeeded") : c("失败", "Failed")}</span><strong>{connections.find((connection) => connection.id === item.connectionId)?.name ?? c("已撤销连接", "Revoked connection")}</strong><small>{item.action} · {new Date(item.occurredAt).toLocaleString(locale)}</small></li>)}</ol> : <p>{c("调用工具使用连接后，这里会出现操作记录。", "Activity appears here after a tool uses a connection.")}</p>}</section>
      <p className="api-account-note"><ShieldCheck size={16} />{c(`这些连接属于 ${accountEmail}，不能切换到其他账户，也不会获得你的登录密码。`, `These connections belong to ${accountEmail}. They cannot switch accounts or access your sign-in password.`)}</p>
      </> : null}
    </section>
  );
}

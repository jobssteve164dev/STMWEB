import { Loader2, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import App from "./App.js";
import { getSession, signIn, signOut, type AuthUser } from "./auth-client.js";
import { configureWorkspace } from "./db.js";

interface BootstrapData {
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
}

function LoginScreen({ message }: { message?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message || "");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await signIn(String(data.get("username") || ""), String(data.get("password") || ""));
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span><ShieldCheck size={24} /></span><strong>STMWEB</strong></div>
        <div className="login-copy">
          <span className="login-kicker"><LockKeyhole size={14} />内部调试工作台</span>
          <h1 id="login-title">登录后继续调试</h1>
          <p>使用管理员为你配置的内部账号进入。设备、固件和调试记录会保存到你的工作区。</p>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label><span>账号</span><input name="username" autoComplete="username" required autoFocus /></label>
          <label><span>密码</span><input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="github-login" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spinning" size={19} /> : <LogIn size={19} />}
            {busy ? "正在登录" : "登录"}
          </button>
        </form>
        <p className="login-footnote">账号由管理员预先配置，当前不开放注册。</p>
      </section>
    </main>
  );
}

export default function AuthenticatedApp() {
  const [sessionUser, setSessionUser] = useState<AuthUser | null | undefined>(undefined);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSession().then(({ user }) => setSessionUser(user)).catch(() => setSessionUser(null));
  }, []);

  useEffect(() => {
    if (!sessionUser) return;
    let active = true;
    void fetch("/api/bootstrap", { credentials: "same-origin" })
      .then(async (response) => {
        const body = await response.json() as BootstrapData & { error?: string };
        if (!response.ok) throw new Error(body.error || "无法加载工作区");
        return body;
      })
      .then((data) => {
        if (!active) return;
        const workspace = data.workspaces[0];
        if (!workspace) throw new Error("账号还没有可用工作区");
        configureWorkspace(workspace.id);
        setBootstrap(data);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法进入工作区");
      });
    return () => { active = false; };
  }, [sessionUser]);

  if (sessionUser === undefined) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>正在确认登录状态</span></main>;
  }
  if (!sessionUser) return <LoginScreen />;
  if (error) return <LoginScreen message={error} />;
  if (!bootstrap) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>正在打开工作区</span></main>;
  }

  return (
    <App
      workspace={bootstrap.workspaces[0]}
      user={bootstrap.user}
      onSignOut={() => void signOut().then(() => window.location.reload())}
    />
  );
}

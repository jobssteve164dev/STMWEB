import { Loader2, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import App from "./App.js";
import { authClient } from "./auth-client.js";
import { configureWorkspace } from "./db.js";

interface BootstrapData {
  user: { id: string; email: string; name: string };
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
}

function LoginScreen({ message }: { message?: string }) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    await authClient.signIn.social({ provider: "github", callbackURL: "/" });
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span><ShieldCheck size={24} /></span><strong>STMWEB</strong></div>
        <div className="login-copy">
          <span className="login-kicker"><LockKeyhole size={14} />内部调试工作台</span>
          <h1 id="login-title">登录后继续调试</h1>
          <p>使用已获授权的 GitHub 账号进入。设备、固件和调试记录会保存到你的工作区。</p>
        </div>
        {message ? <div className="login-error" role="alert">{message}</div> : null}
        <button className="github-login" type="button" disabled={busy} onClick={() => void signIn()}>
          {busy ? <Loader2 className="spinning" size={19} /> : <LogIn size={19} />}
          {busy ? "正在前往 GitHub" : "使用 GitHub 登录"}
        </button>
        <p className="login-footnote">STMWEB 不会获得你的 GitHub 密码。</p>
      </section>
    </main>
  );
}

export default function AuthenticatedApp() {
  const session = authClient.useSession();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session.data?.user) return;
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
  }, [session.data?.user]);

  if (session.isPending) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>正在确认登录状态</span></main>;
  }
  if (!session.data?.user) return <LoginScreen />;
  if (error) return <LoginScreen message={error} />;
  if (!bootstrap) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>正在打开工作区</span></main>;
  }

  return (
    <App
      workspace={bootstrap.workspaces[0]}
      user={bootstrap.user}
      onSignOut={() => void authClient.signOut()}
    />
  );
}

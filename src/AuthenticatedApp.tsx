import { Loader2, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import App from "./App.js";
import { getSession, signIn, signOut, type AuthUser } from "./auth-client.js";
import { configureWorkspace } from "./db.js";
import { useLocale } from "./i18n.js";

interface BootstrapData {
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
  planAccess: { tier: "free" | "pro"; pro: boolean; status: "ready" | "unavailable" };
}

function LoginScreen({ message }: { message?: string }) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message || "");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await signIn(String(data.get("email") || ""), String(data.get("password") || ""));
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("登录失败", "Sign-in failed"));
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <a className="login-brand" href="/"><span><ShieldCheck size={24} /></span><strong>STMWEB</strong></a>
        <div className="login-copy">
          <span className="login-kicker"><LockKeyhole size={14} />{c("硬件调试工作台", "Hardware Debugging Workbench")}</span>
          <h1 id="login-title">{c("登录后继续调试", "Sign in to continue debugging")}</h1>
          <p>{c("使用 SZLKPassport 账号进入。设备、固件和调试记录会安全地保存在你的工作区。", "Use your SZLKPassport account. Devices, firmware and debugging records are stored securely in your workspace.")}</p>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label><span>{c("邮箱", "Email")}</span><input name="email" type="email" autoComplete="email" spellCheck={false} required /></label>
          <label><span>{c("密码", "Password")}</span><input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="github-login" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spinning" size={19} /> : <LogIn size={19} />}
            {busy ? c("正在登录", "Signing in…") : c("登录", "Sign In")}
          </button>
        </form>
        <p className="login-footnote">{c("账号和订阅由 SZLKPassport 统一管理。", "Accounts and subscriptions are managed by SZLKPassport.")}</p>
        <nav className="login-links" aria-label={c("产品与法律信息", "Product and legal information")}><a href="/">{c("产品首页", "Product Home")}</a><a href="/plans">{c("产品计划", "Product Plans")}</a><a href="/terms">{c("服务条款", "Terms")}</a><a href="/privacy">{c("隐私政策", "Privacy")}</a></nav>
      </section>
    </main>
  );
}

export default function AuthenticatedApp() {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [sessionUser, setSessionUser] = useState<AuthUser | null | undefined>(undefined);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = c("STMWEB · 硬件调试工作台", "STMWEB · Hardware Debugging Workbench");
    document.querySelector('meta[name="description"]')?.setAttribute("content", c("通过浏览器连接、记录和管理 STM32 智能硬件调试过程。", "Connect, record and manage STM32 hardware debugging sessions in your browser."));
  }, [isEnglish]);

  useEffect(() => {
    void getSession().then(({ user }) => setSessionUser(user)).catch(() => setSessionUser(null));
  }, []);

  useEffect(() => {
    if (!sessionUser) return;
    const next = new URLSearchParams(window.location.search).get("next");
    if (next === "/plans") {
      window.location.replace(next);
      return;
    }
    let active = true;
    void fetch("/api/bootstrap", { credentials: "same-origin" })
      .then(async (response) => {
        const body = await response.json() as BootstrapData & { error?: string };
        if (!response.ok) throw new Error(body.error || c("无法加载工作区", "Unable to load the workspace"));
        return body;
      })
      .then((data) => {
        if (!active) return;
        const workspace = data.workspaces[0];
        if (!workspace) throw new Error(c("账号还没有可用工作区", "This account does not have an available workspace"));
        configureWorkspace(workspace.id);
        setBootstrap(data);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : c("无法进入工作区", "Unable to open the workspace"));
      });
    return () => { active = false; };
  }, [isEnglish, sessionUser]);

  if (sessionUser === undefined) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>{c("正在确认登录状态", "Checking your session…")}</span></main>;
  }
  if (!sessionUser) return <LoginScreen />;
  if (error) return <LoginScreen message={error} />;
  if (!bootstrap) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>{c("正在打开工作区", "Opening your workspace…")}</span></main>;
  }

  return (
    <App
      workspace={bootstrap.workspaces[0]}
      user={bootstrap.user}
      planAccess={bootstrap.planAccess}
      onSignOut={() => void signOut().then(() => window.location.reload())}
    />
  );
}

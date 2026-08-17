import { Loader2, LockKeyhole, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import App from "./App.js";
import {
  AuthRequestError,
  getSession,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signIn,
  signOut,
  verifyEmail,
  type AuthUser,
} from "./auth-client.js";
import { configureWorkspace } from "./db.js";
import { useLocale } from "./i18n.js";

interface BootstrapData {
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
  planAccess: { tier: "free" | "pro"; pro: boolean; status: "ready" | "unavailable" };
}

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify" | "check-email";

function LoginScreen({ initialMode = "login", message }: { initialMode?: AuthMode; message?: string }) {
  const { isEnglish } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [pendingAction, setPendingAction] = useState<"verification" | "reset">("verification");
  const [busy, setBusy] = useState(initialMode === "verify");
  const [error, setError] = useState(message || "");
  const verificationStarted = useRef(false);

  useEffect(() => {
    if (initialMode !== "verify" || verificationStarted.current) return;
    verificationStarted.current = true;
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setError(c("验证链接不完整，请重新获取验证邮件", "This verification link is incomplete. Please request a new email."));
      setBusy(false);
      return;
    }
    void verifyEmail(token)
      .then(() => window.location.replace("/workbench"))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : c("邮箱验证没有完成", "Email verification could not be completed"));
        setBusy(false);
      });
  }, [initialMode, isEnglish]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await signIn(String(data.get("email") || ""), String(data.get("password") || ""));
        window.location.assign("/workbench");
      } else if (mode === "register") {
        const nextEmail = String(data.get("email") || "");
        await register(String(data.get("name") || ""), nextEmail, String(data.get("password") || ""));
        setEmail(nextEmail);
        setPendingAction("verification");
        setMode("check-email");
      } else if (mode === "forgot") {
        const nextEmail = String(data.get("email") || "");
        await requestPasswordReset(nextEmail);
        setEmail(nextEmail);
        setPendingAction("reset");
        setMode("check-email");
      } else if (mode === "reset") {
        const token = new URLSearchParams(window.location.search).get("token") || "";
        await resetPassword(token, String(data.get("password") || ""));
        window.location.assign("/workbench");
      }
    } catch (reason) {
      if (mode === "login" && reason instanceof AuthRequestError && reason.code === "email_verification_required") {
        setEmail(reason.email || String(data.get("email") || ""));
        setPendingAction("verification");
        setMode("check-email");
        setBusy(false);
        return;
      }
      setError(reason instanceof Error ? reason.message : c("登录失败", "Sign-in failed"));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      if (pendingAction === "verification") await resendVerification(email);
      else await requestPasswordReset(email);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("邮件没有发送成功", "The email could not be sent"));
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const title = mode === "verify"
    ? c("正在验证邮箱", "Verifying your email")
    : mode === "check-email"
      ? c("请查看邮箱", "Check your email")
      : isRegister
        ? c("注册 SZLKPassport 账号", "Create your SZLKPassport account")
        : isForgot
          ? c("找回密码", "Reset your password")
          : isReset
            ? c("设置新密码", "Choose a new password")
            : c("登录后继续调试", "Sign in to continue debugging");
  const description = mode === "verify"
    ? c("验证完成后会直接打开你的工作台。", "Your workbench will open as soon as verification is complete.")
    : mode === "check-email"
      ? email
        ? c(`我们已经向 ${email} 发送了下一步链接。`, `We sent the next-step link to ${email}.`)
        : c("我们已经发送了下一步链接。", "We sent the next-step link.")
      : isRegister
        ? c("一个账号即可安全保存你的设备、固件和调试记录。", "One account securely stores your devices, firmware and debugging records.")
        : isForgot
          ? c("输入注册邮箱，我们会发送密码重置链接。", "Enter your account email and we'll send a password reset link.")
          : isReset
            ? c("设置一个至少 8 位的新密码。", "Choose a new password with at least 8 characters.")
            : c("使用 SZLKPassport 账号进入。设备、固件和调试记录会安全地保存在你的工作区。", "Use your SZLKPassport account. Devices, firmware and debugging records are stored securely in your workspace.");

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <a className="login-brand" href="/"><span><ShieldCheck size={24} /></span><strong>STMWEB</strong></a>
        <div className="login-copy">
          <span className="login-kicker"><LockKeyhole size={14} />{c("硬件调试工作台", "Hardware Debugging Workbench")}</span>
          <h1 id="login-title">{title}</h1>
          <p>{description}</p>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        {mode === "verify" ? <div className="login-status" role="status">{busy ? <><Loader2 className="spinning" size={19} />{c("请稍候…", "Please wait…")}</> : null}</div> : null}
        {mode === "check-email" ? <div className="login-actions"><button className="github-login" type="button" onClick={() => switchMode("login")}><LogIn size={19} />{c("返回登录", "Back to sign in")}</button><button className="login-secondary" type="button" disabled={busy || !email} onClick={() => void resend()}>{busy ? <Loader2 className="spinning" size={17} /> : <MailCheck size={17} />}{busy ? c("正在发送…", "Sending…") : pendingAction === "verification" ? c("重新发送验证邮件", "Resend verification email") : c("重新发送重置邮件", "Resend reset email")}</button></div> : null}
        {!(["verify", "check-email"] as AuthMode[]).includes(mode) ? <>
          <form className="login-form" onSubmit={(event) => void submit(event)}>
            {isRegister ? <label><span>{c("你的称呼", "Your name")}</span><input name="name" type="text" autoComplete="name" maxLength={80} /></label> : null}
            {!isReset ? <label><span>{c("邮箱", "Email")}</span><input name="email" type="email" autoComplete="email" spellCheck={false} required autoFocus /></label> : null}
            {!isForgot ? <label><span>{isReset ? c("新密码", "New password") : c("密码", "Password")}</span><input name="password" type="password" autoComplete={isRegister || isReset ? "new-password" : "current-password"} minLength={isRegister || isReset ? 8 : undefined} required /></label> : null}
            <button className="github-login" type="submit" disabled={busy}>
              {busy ? <Loader2 className="spinning" size={19} /> : isRegister ? <UserPlus size={19} /> : <LogIn size={19} />}
              {busy ? c("请稍候…", "Please wait…") : isRegister ? c("注册并验证邮箱", "Register and verify email") : isForgot ? c("发送重置链接", "Send reset link") : isReset ? c("保存新密码", "Save new password") : c("登录", "Sign In")}
            </button>
          </form>
          <div className="login-switch">
            {mode === "login" ? <><button type="button" onClick={() => switchMode("register")}>{c("注册账号", "Create account")}</button><button type="button" onClick={() => switchMode("forgot")}>{c("忘记密码", "Forgot password")}</button></> : <button type="button" onClick={() => switchMode("login")}>{c("返回登录", "Back to sign in")}</button>}
          </div>
        </> : null}
        <p className="login-footnote">{c("账号和订阅由 SZLKPassport 统一管理。", "Accounts and subscriptions are managed by SZLKPassport.")}</p>
        <nav className="login-links" aria-label={c("产品与法律信息", "Product and legal information")}><a href="/">{c("产品首页", "Product Home")}</a><a href="/plans">{c("产品计划", "Product Plans")}</a><a href="/terms">{c("服务条款", "Terms")}</a><a href="/privacy">{c("隐私政策", "Privacy")}</a></nav>
      </section>
    </main>
  );
}

export default function AuthenticatedApp({ initialAuthMode = "login" }: { initialAuthMode?: AuthMode }) {
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

  if (initialAuthMode === "verify" || initialAuthMode === "reset") return <LoginScreen initialMode={initialAuthMode} />;
  if (sessionUser === undefined) {
    return <main className="app-loading"><Loader2 className="spinning" size={24} /><span>{c("正在确认登录状态", "Checking your session…")}</span></main>;
  }
  if (!sessionUser) return <LoginScreen initialMode={initialAuthMode} />;
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

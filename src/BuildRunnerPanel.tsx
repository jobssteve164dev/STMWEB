import { ArrowRight, Check, CircleAlert, Clipboard, CloudCog, Download, FileArchive, Loader2, LockKeyhole, Play, Plus, RefreshCw, Square, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildArtifactUrl,
  cancelBuildJob,
  createBuildJob,
  createRunnerPairing,
  listBuildJobs,
  listBuildRunners,
  type BuildJobRecord,
  type BuildRunnerRecord,
} from "./db.js";
import { useLocale } from "./i18n.js";

const statusText: Record<BuildJobRecord["status"], string> = {
  queued: "等待编译", leased: "正在准备", running: "正在编译", succeeded: "编译完成", failed: "编译失败", cancelled: "已取消",
};

export function BuildRunnerPanel({ proAccess }: { proAccess: boolean }) {
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [runners, setRunners] = useState<BuildRunnerRecord[]>([]);
  const [jobs, setJobs] = useState<BuildJobRecord[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; command: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try {
      const [savedRunners, savedJobs] = await Promise.all([listBuildRunners(), listBuildJobs()]);
      setRunners(savedRunners); setJobs(savedJobs); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : c("无法读取编译算力", "Unable to load build runners")); }
  }

  useEffect(() => {
    if (!proAccess) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [proAccess]);

  if (!proAccess) {
    return (
      <article className="workbench-card pro-feature-gate">
        <span className="pro-feature-icon"><LockKeyhole size={22} /></span>
        <div><span>PRO</span><strong>{c("用自己的 Runner 构建固件", "Build Firmware on Your Own Runner")}</strong><p>{c("免费计划保留浏览器连接和完整调试记录；升级后可接入 x86 Linux 算力、创建构建并下载校验后的制品。", "The Free plan keeps browser connectivity and full debugging records. Upgrade to connect x86 Linux compute, create builds and download verified artefacts.")}</p></div>
        <a className="primary-button" href="/plans">{c("查看 Pro 计划", "View Pro Plan")} <ArrowRight size={16} /></a>
      </article>
    );
  }

  async function generatePairing() {
    setBusy(true);
    try { setPairing(await createRunnerPairing()); }
    catch (error) { setMessage(error instanceof Error ? error.message : c("无法生成连接命令", "Unable to generate the connection command")); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = fileRef.current?.files?.[0];
    if (!source) { setMessage(c("请选择 ZIP 源码包", "Choose a ZIP source archive")); return; }
    setBusy(true);
    try {
      await createBuildJob({
        runnerId: String(form.get("runnerId")), name: String(form.get("name")),
        target: String(form.get("target")) as "stm32f103c8" | "stm32f103cb", source,
      });
      event.currentTarget.reset(); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c("无法创建构建", "Unable to create the build")); }
    finally { setBusy(false); }
  }

  const available = runners.filter((runner) => runner.status === "online");
  return (
    <article className="workbench-card build-runner-widget">
      <div className="widget-heading"><div><CloudCog size={18} /><strong>{c("固件构建", "Firmware Build")}</strong></div><button type="button" aria-label={c("刷新编译状态", "Refresh build status")} onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
      <div className="runner-summary">
        <div><span className={available.length ? "runner-status online" : "runner-status"}><i />{available.length ? c(`${available.length} 台算力可用`, `${available.length} runner${available.length === 1 ? "" : "s"} available`) : c("尚未连接编译算力", "No build runner connected")}</span><small>{c("Runner 通过出站 HTTPS 主动领取任务", "The Runner collects jobs over outbound HTTPS")}</small></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void generatePairing()}>{busy ? <Loader2 className="spinning" size={16} /> : <Plus size={16} />}{c("连接编译算力", "Connect Runner")}</button>
      </div>
      {pairing ? <div className="pairing-command"><div><TerminalSquare size={17} /><strong>{c("在 x86 Linux 节点执行", "Run on the x86 Linux node")}</strong><span>{c("配对码将在", "Pairing code expires at")} {new Date(pairing.expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span></div><code>{pairing.command}</code><button type="button" onClick={() => void navigator.clipboard.writeText(pairing.command)}><Clipboard size={15} />{c("复制命令", "Copy Command")}</button></div> : null}
      {available.length ? (
        <form className="build-form" onSubmit={(event) => void submit(event)}>
          <label><span>{c("构建名称", "Build name")}</span><input name="name" required maxLength={160} placeholder={c("例如：平衡控制 v1.1", "e.g. Balance Control v1.1")} /></label>
          <label><span>{c("编译算力", "Build runner")}</span><select name="runnerId" required>{available.map((runner) => <option key={runner.id} value={runner.id}>{runner.name} · {runner.capabilities.architecture || "amd64"}</option>)}</select></label>
          <label><span>{c("目标芯片", "Target chip")}</span><select name="target" required><option value="stm32f103cb">STM32F103CB · 128 KB</option><option value="stm32f103c8">STM32F103C8 · 64 KB</option></select></label>
          <label><span>{c("源码包", "Source archive")}</span><input ref={fileRef} name="source" type="file" accept=".zip,application/zip" required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="spinning" size={16} /> : <Play size={16} />}{busy ? c("正在创建", "Creating…") : c("创建构建", "Create Build")}</button>
        </form>
      ) : null}
      {message ? <div className="inline-error" role="alert"><CircleAlert size={16} />{message}</div> : null}
      <div className="build-list">
        {jobs.length === 0 ? <div className="build-empty"><FileArchive size={20} /><span>{c("连接算力并提交源码后，构建进度会显示在这里。", "Build progress appears here after you connect a runner and submit source code.")}</span></div> : jobs.slice(0, 8).map((job) => (
          <div className="build-row" key={job.id}>
            <span className={`build-state ${job.status}`}>{job.status === "succeeded" ? <Check size={15} /> : job.status === "failed" ? <CircleAlert size={15} /> : <Loader2 className={job.status === "running" ? "spinning" : ""} size={15} />}</span>
            <div><strong>{job.name}</strong><span>{job.runnerName} · {job.target.toUpperCase()} · {isEnglish ? ({ queued: "Queued", leased: "Preparing", running: "Building", succeeded: "Complete", failed: "Failed", cancelled: "Cancelled" } as const)[job.status] : statusText[job.status]}</span>{job.error ? <small>{job.error}</small> : null}</div>
            <span className="build-progress">{job.progress}%</span>
            {job.artifacts.map((artifact) => <a key={artifact.id} href={buildArtifactUrl(job.id, artifact.id)} download><Download size={14} />{artifact.kind.toUpperCase()}</a>)}
            {["queued", "leased", "running"].includes(job.status) ? <button type="button" aria-label={c(`取消 ${job.name}`, `Cancel ${job.name}`)} onClick={() => void cancelBuildJob(job.id).then(refresh)}><Square size={14} />{c("取消", "Cancel")}</button> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

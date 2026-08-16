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

const statusText: Record<BuildJobRecord["status"], string> = {
  queued: "等待编译", leased: "正在准备", running: "正在编译", succeeded: "编译完成", failed: "编译失败", cancelled: "已取消",
};

export function BuildRunnerPanel({ proAccess }: { proAccess: boolean }) {
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
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取编译算力"); }
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
        <div><span>PRO</span><strong>用自己的 Runner 构建固件</strong><p>免费计划保留浏览器连接和完整调试记录；升级后可接入 x86 Linux 算力、创建构建并下载校验后的制品。</p></div>
        <a className="primary-button" href="/plans">查看 Pro 计划 <ArrowRight size={16} /></a>
      </article>
    );
  }

  async function generatePairing() {
    setBusy(true);
    try { setPairing(await createRunnerPairing()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法生成连接命令"); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = fileRef.current?.files?.[0];
    if (!source) { setMessage("请选择 ZIP 源码包"); return; }
    setBusy(true);
    try {
      await createBuildJob({
        runnerId: String(form.get("runnerId")), name: String(form.get("name")),
        target: String(form.get("target")) as "stm32f103c8" | "stm32f103cb", source,
      });
      event.currentTarget.reset(); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法创建构建"); }
    finally { setBusy(false); }
  }

  const available = runners.filter((runner) => runner.status === "online");
  return (
    <article className="workbench-card build-runner-widget">
      <div className="widget-heading"><div><CloudCog size={18} /><strong>编译与烧录</strong></div><button type="button" aria-label="刷新编译状态" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
      <div className="runner-summary">
        <div><span className={available.length ? "runner-status online" : "runner-status"}><i />{available.length ? `${available.length} 台算力可用` : "尚未连接编译算力"}</span><small>Runner 通过出站 HTTPS 主动领取任务</small></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void generatePairing()}>{busy ? <Loader2 className="spinning" size={16} /> : <Plus size={16} />}连接编译算力</button>
      </div>
      {pairing ? <div className="pairing-command"><div><TerminalSquare size={17} /><strong>在 x86 Linux 节点执行</strong><span>配对码将在 {new Date(pairing.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 失效</span></div><code>{pairing.command}</code><button type="button" onClick={() => void navigator.clipboard.writeText(pairing.command)}><Clipboard size={15} />复制命令</button></div> : null}
      {available.length ? (
        <form className="build-form" onSubmit={(event) => void submit(event)}>
          <label><span>构建名称</span><input name="name" required maxLength={160} placeholder="例如：平衡控制 v1.1" /></label>
          <label><span>编译算力</span><select name="runnerId" required>{available.map((runner) => <option key={runner.id} value={runner.id}>{runner.name} · {runner.capabilities.architecture || "amd64"}</option>)}</select></label>
          <label><span>目标芯片</span><select name="target" required><option value="stm32f103cb">STM32F103CB · 128 KB</option><option value="stm32f103c8">STM32F103C8 · 64 KB</option></select></label>
          <label><span>源码包</span><input ref={fileRef} name="source" type="file" accept=".zip,application/zip" required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="spinning" size={16} /> : <Play size={16} />}{busy ? "正在创建" : "创建构建"}</button>
        </form>
      ) : null}
      {message ? <div className="inline-error" role="alert"><CircleAlert size={16} />{message}</div> : null}
      <div className="build-list">
        {jobs.length === 0 ? <div className="build-empty"><FileArchive size={20} /><span>连接算力并提交源码后，构建进度会显示在这里。</span></div> : jobs.slice(0, 8).map((job) => (
          <div className="build-row" key={job.id}>
            <span className={`build-state ${job.status}`}>{job.status === "succeeded" ? <Check size={15} /> : job.status === "failed" ? <CircleAlert size={15} /> : <Loader2 className={job.status === "running" ? "spinning" : ""} size={15} />}</span>
            <div><strong>{job.name}</strong><span>{job.runnerName} · {job.target.toUpperCase()} · {statusText[job.status]}</span>{job.error ? <small>{job.error}</small> : null}</div>
            <span className="build-progress">{job.progress}%</span>
            {job.artifacts.map((artifact) => <a key={artifact.id} href={buildArtifactUrl(job.id, artifact.id)} download><Download size={14} />{artifact.kind.toUpperCase()}</a>)}
            {["queued", "leased", "running"].includes(job.status) ? <button type="button" aria-label={`取消 ${job.name}`} onClick={() => void cancelBuildJob(job.id).then(refresh)}><Square size={14} />取消</button> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

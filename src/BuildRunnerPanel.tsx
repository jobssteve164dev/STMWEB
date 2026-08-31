import { ArrowRight, Check, CircleAlert, Clipboard, CloudCog, Download, FileArchive, Loader2, LockKeyhole, Play, Plus, RefreshCw, Square, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildArtifactUrl,
  cancelBuildJob,
  createBuildJob,
  createHardwareProject,
  createRunnerPairing,
  listBuildJobs,
  listBuildRunners,
  listHardwareProjects,
  listHardwareTemplates,
  publishFirmwarePackage,
  type BuildArtifactRecord,
  type BuildJobRecord,
  type BuildRunnerRecord,
  type HardwareProjectRecord,
  type HardwareTemplateRecord,
} from "./db.js";
import { useLocale } from "./i18n.js";

const statusText: Record<BuildJobRecord["status"], string> = {
  queued: "等待编译", leased: "正在准备", running: "正在编译", succeeded: "编译完成", failed: "编译失败", cancelled: "已取消",
};

function formatArtifactSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MiB`;
}

function CardputerInitialInstall({ artifact, isEnglish }: { artifact: BuildArtifactRecord; isEnglish: boolean }) {
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const command = `python -m esptool --chip esp32s3 write_flash 0x0 ${artifact.name}`;
  return <details className="cardputer-install-guide">
    <summary>{c("首次安装到 Cardputer ADV", "First install on Cardputer ADV")}</summary>
    <ol>
      <li>{c("先下载上方的完整固件。", "Download the complete firmware above.")}</li>
      <li>{c("关闭设备，按住顶部 G0，接入 USB 后松开 G0。", "Turn the device off, hold G0 on top, connect USB, then release G0.")}</li>
      <li>{c("在固件所在文件夹执行下方命令；完成后设备会重新启动。", "Run the command below in the firmware folder. The device restarts when installation finishes.")}</li>
    </ol>
    <div className="install-command"><code>{command}</code><button type="button" onClick={() => void navigator.clipboard.writeText(command)}><Clipboard size={14} />{c("复制命令", "Copy command")}</button></div>
  </details>;
}

export function BuildRunnerPanel({ proAccess }: { proAccess: boolean }) {
  const { isEnglish, locale } = useLocale();
  const c = (zh: string, en: string) => isEnglish ? en : zh;
  const [runners, setRunners] = useState<BuildRunnerRecord[]>([]);
  const [jobs, setJobs] = useState<BuildJobRecord[]>([]);
  const [hardwareProjects, setHardwareProjects] = useState<HardwareProjectRecord[]>([]);
  const [hardwareTemplates, setHardwareTemplates] = useState<HardwareTemplateRecord[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; command: string } | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [buildProjectId, setBuildProjectId] = useState("");
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const knownPackages = useRef(new Set<string>());

  async function refresh() {
    try {
      const [savedRunners, savedJobs, savedHardwareProjects, savedHardwareTemplates] = await Promise.all([
        listBuildRunners(), listBuildJobs(), listHardwareProjects(), listHardwareTemplates(),
      ]);
      setRunners(savedRunners); setJobs(savedJobs); setHardwareProjects(savedHardwareProjects); setHardwareTemplates(savedHardwareTemplates); setMessage("");
      setBuildProjectId((current) => current && savedHardwareProjects.some((project) => project.id === current) ? current : savedHardwareProjects[0]?.id ?? "");
      const nextPackages = new Set(savedJobs.flatMap((job) => job.packageId ? [job.packageId] : []));
      if ([...nextPackages].some((id) => !knownPackages.current.has(id))) window.dispatchEvent(new Event("stmweb:firmware-updated"));
      knownPackages.current = nextPackages;
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
        <div><span>PRO</span><strong>{c("用自己的设备生成固件", "Generate firmware on your own device")}</strong><p>{c("免费计划保留浏览器连接和完整调试记录；升级后可连接 Linux 电脑或服务器，生成可直接烧录的固件。", "The Free plan keeps browser connectivity and full debugging records. Upgrade to connect a Linux computer or server and generate flash-ready firmware.")}</p></div>
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
    const project = hardwareProjects.find((candidate) => candidate.id === String(form.get("hardwareProjectId")));
    if (project?.hardwareProfileId !== "stmweb.cardputer-adv" && !source) { setMessage(c("请选择 ZIP 源码包", "Choose a ZIP source archive")); return; }
    setBusy(true);
    try {
      await createBuildJob({
        runnerId: String(form.get("runnerId")), name: String(form.get("name")),
        hardwareProjectId: String(form.get("hardwareProjectId")), source,
      });
      event.currentTarget.reset(); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c("无法创建构建", "Unable to create the build")); }
    finally { setBusy(false); }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const template = hardwareTemplates.find((candidate) => `${candidate.hardwareProfileId}:${candidate.adapterVersion}:${candidate.target}` === templateKey);
    if (!template) { setMessage(c("请选择硬件模板", "Choose a hardware template")); return; }
    setBusy(true);
    try {
      await createHardwareProject({ name: String(form.get("projectName")), template, selectedModuleIds });
      event.currentTarget.reset(); setTemplateKey(""); setSelectedModuleIds([]);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c("无法创建硬件项目", "Unable to create the hardware project")); }
    finally { setBusy(false); }
  }

  const selectedTemplate = hardwareTemplates.find((candidate) => `${candidate.hardwareProfileId}:${candidate.adapterVersion}:${candidate.target}` === templateKey);
  const selectableModules = selectedTemplate ? [...selectedTemplate.capabilityModules, ...selectedTemplate.connectionModules] : [];
  const hasOptionalConnections = selectedTemplate?.connectionModules.some((module) => !module.required) ?? false;

  function selectTemplate(value: string) {
    setTemplateKey(value);
    const template = hardwareTemplates.find((candidate) => `${candidate.hardwareProfileId}:${candidate.adapterVersion}:${candidate.target}` === value);
    setSelectedModuleIds(template ? [...template.capabilityModules, ...template.connectionModules]
      .filter((module) => module.defaultEnabled || module.required).map((module) => module.id) : []);
  }

  function toggleModule(moduleId: string, enabled: boolean) {
    const next = new Set(selectedModuleIds);
    if (enabled) {
      const queue = [moduleId];
      while (queue.length) {
        const current = queue.shift()!;
        if (next.has(current)) continue;
        next.add(current);
        const module = selectableModules.find((candidate) => candidate.id === current);
        if (module) queue.push(...module.requires);
      }
    } else {
      next.delete(moduleId);
      let changed = true;
      while (changed) {
        changed = false;
        for (const module of selectableModules) {
          if (next.has(module.id) && module.requires.some((dependency) => !next.has(dependency))) { next.delete(module.id); changed = true; }
        }
      }
    }
    setSelectedModuleIds([...next]);
  }

  async function publishPackage(packageId: string) {
    setBusy(true);
    try {
      await publishFirmwarePackage(packageId);
      window.dispatchEvent(new Event("stmweb:firmware-updated"));
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c("无法发布稳定版", "Unable to publish stable firmware")); }
    finally { setBusy(false); }
  }

  const available = runners.filter((runner) => runner.status === "online" && runner.capabilities.firmwareCompositionVersion === 2);
  const needsUpdate = runners.some((runner) => runner.status === "online" && runner.capabilities.firmwareCompositionVersion !== 2);
  return (
    <article className="workbench-card build-runner-widget">
      <div className="widget-heading"><div><CloudCog size={18} /><strong>{c("标准固件生成", "Standard Firmware Generation")}</strong></div><button type="button" aria-label={c("刷新生成状态", "Refresh generation status")} onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
      <form className="firmware-composer" onSubmit={(event) => void createProject(event)}>
        <div className="composer-heading"><div><strong>{c("组装标准固件", "Compose standard firmware")}</strong><span>{c("选择硬件和需要的能力，其余启动、恢复和校验模块由平台自动完成。", "Choose the hardware and capabilities. Boot, recovery and validation are assembled automatically.")}</span></div><span className="composer-step">1</span></div>
        <div className="composer-basics">
          <label><span>{c("固件项目名称", "Firmware project name")}</span><input name="projectName" required maxLength={160} placeholder={c("例如：我的 DOT 小车", "e.g. My DOT vehicle")} /></label>
          <label><span>{c("板卡模板", "Board template")}</span><select name="template" required value={templateKey} onChange={(event) => selectTemplate(event.target.value)}><option value="" disabled>{c("选择板卡和容量", "Choose board and capacity")}</option>{hardwareTemplates.map((template) => <option key={`${template.hardwareProfileId}:${template.adapterVersion}:${template.target}`} value={`${template.hardwareProfileId}:${template.adapterVersion}:${template.target}`}>{template.adapterLabel} · {template.targetLabel}</option>)}</select></label>
        </div>
        {selectedTemplate ? <div className="composer-board">
          <fieldset className="composer-module-group"><legend>{c("添加功能", "Add capabilities")}</legend><p>{c("只选择这份固件实际需要提供的能力。依赖项会自动加入。", "Select only the capabilities this firmware needs. Dependencies are added automatically.")}</p><div className="composer-module-grid">{selectedTemplate.capabilityModules.map((module) => <label className={selectedModuleIds.includes(module.id) ? "composer-module selected" : "composer-module"} key={module.id}><input type="checkbox" checked={selectedModuleIds.includes(module.id)} disabled={module.required} onChange={(event) => toggleModule(module.id, event.target.checked)} /><span><strong>{isEnglish ? module.label.en : module.label.zh}</strong><small>{isEnglish ? module.description.en : module.description.zh}</small></span><Check size={16} /></label>)}</div></fieldset>
          <fieldset className="composer-module-group"><legend>{c("连接方式", "Connections")}</legend><p>{hasOptionalConnections ? c("首次安装和恢复方式会始终保留；硬件支持的无线方式可以按需加入。", "Installation and recovery always remain available. Supported wireless methods are optional.") : c("首次安装、恢复和无线升级已经包含在这份固件中。", "Installation, recovery, and wireless updates are included in this firmware.")}</p><div className="composer-module-grid connection">{selectedTemplate.connectionModules.map((module) => <label className={selectedModuleIds.includes(module.id) ? "composer-module selected" : "composer-module"} key={module.id}><input type="checkbox" checked={selectedModuleIds.includes(module.id)} disabled={module.required} onChange={(event) => toggleModule(module.id, event.target.checked)} /><span><strong>{isEnglish ? module.label.en : module.label.zh}</strong><small>{isEnglish ? module.description.en : module.description.zh}</small></span><Check size={16} /></label>)}</div></fieldset>
          <div className="composer-foundation"><div><span>{c("平台自动装配", "Automatically assembled")}</span><strong>{selectedTemplate.foundationModules.map((module) => isEnglish ? module.label.en : module.label.zh).join(" · ")}</strong></div><div><span>{c("生成结果", "Generated output")}</span><strong>{c("完整固件 + 应用固件", "Complete firmware + application firmware")}</strong></div></div>
          <button className="secondary-button composer-submit" type="submit" disabled={busy}><Plus size={16} />{c("保存固件配置", "Save firmware configuration")}</button>
        </div> : <div className="composer-placeholder">{c("选择板卡后，即可配置这份固件的功能和连接方式。", "Choose a board to configure firmware capabilities and connections.")}</div>}
      </form>
      {hardwareProjects.length ? <div className="hardware-project-list" aria-label={c("当前固件配置", "Current firmware configurations")}>{hardwareProjects.map((project) => <span key={project.id}><Check size={14} />{project.name}<small>{project.firmwareConfiguration.capabilityModules.length} {c("项能力", "capabilities")} · {project.firmwareConfiguration.flashMethods.map((method) => method === "swd" ? "SWD" : method === "usb" ? "USB" : c("蓝牙", "Bluetooth")).join(" + ")}</small></span>)}</div> : null}
      <div className="runner-summary">
        <div><span className={available.length ? "runner-status online" : "runner-status"}><i />{available.length ? c(`${available.length} 台生成设备可用`, `${available.length} build device${available.length === 1 ? "" : "s"} available`) : needsUpdate ? c("生成设备需要更新", "Build device update required") : c("尚未连接生成设备", "No build device connected")}</span><small>{needsUpdate && !available.length ? c("重新连接后即可使用固件组装", "Reconnect it to use firmware composition") : c("源码只在你连接的设备中处理", "Source code is processed only on your connected device")}</small></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void generatePairing()}>{busy ? <Loader2 className="spinning" size={16} /> : <Plus size={16} />}{c("连接编译算力", "Connect Runner")}</button>
      </div>
      {pairing ? <div className="pairing-command"><div><TerminalSquare size={17} /><strong>{c("在 x86 Linux 节点执行", "Run on the x86 Linux node")}</strong><span>{c("配对码将在", "Pairing code expires at")} {new Date(pairing.expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span></div><code>{pairing.command}</code><button type="button" onClick={() => void navigator.clipboard.writeText(pairing.command)}><Clipboard size={15} />{c("复制命令", "Copy Command")}</button></div> : null}
      {available.length && hardwareProjects.length ? (
        <form className="build-form" onSubmit={(event) => void submit(event)}>
          <label><span>{c("构建名称", "Build name")}</span><input name="name" required maxLength={160} placeholder={c("例如：平衡控制 v1.1", "e.g. Balance Control v1.1")} /></label>
          <label><span>{c("编译算力", "Build runner")}</span><select name="runnerId" required>{available.map((runner) => <option key={runner.id} value={runner.id}>{runner.name} · {runner.capabilities.architecture || "amd64"}</option>)}</select></label>
          <label><span>{c("硬件项目", "Hardware project")}</span><select name="hardwareProjectId" required value={buildProjectId} onChange={(event) => setBuildProjectId(event.target.value)}>{hardwareProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          {hardwareProjects.find((project) => project.id === buildProjectId)?.hardwareProfileId !== "stmweb.cardputer-adv" ? <label><span>{c("源码包", "Source archive")}</span><input ref={fileRef} name="source" type="file" accept=".zip,application/zip" required /></label> : null}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="spinning" size={16} /> : <Play size={16} />}{busy ? c("正在创建", "Creating…") : c("创建构建", "Create Build")}</button>
        </form>
      ) : null}
      {message ? <div className="inline-error" role="alert"><CircleAlert size={16} />{message}</div> : null}
      <div className="build-list">
        {jobs.length === 0 ? <div className="build-empty"><FileArchive size={20} /><span>{c("连接算力并提交源码后，构建进度会显示在这里。", "Build progress appears here after you connect a runner and submit source code.")}</span></div> : jobs.slice(0, 8).map((job) => (
          <div className="build-row" key={job.id}>
            <span className={`build-state ${job.status}`}>{job.status === "succeeded" ? <Check size={15} /> : job.status === "failed" ? <CircleAlert size={15} /> : <Loader2 className={job.status === "running" ? "spinning" : ""} size={15} />}</span>
            <div><strong>{job.name}</strong><span>{job.hardwareProjectName || job.target.toUpperCase()} · {isEnglish ? ({ queued: "Queued", leased: "Preparing", running: "Building", succeeded: "Complete", failed: "Failed", cancelled: "Cancelled" } as const)[job.status] : statusText[job.status]}</span>{job.packageId ? <small className="package-ready">{c("完整固件和应用固件已进入固件管理", "Complete and application firmware are ready in Firmware Management")}</small> : job.error ? <small>{job.error}</small> : null}</div>
            <span className="build-progress">{job.progress}%</span>
            <div className="build-result-actions">
              {job.packageId && job.packageStatus !== "stable" ? <button type="button" disabled={busy} onClick={() => void publishPackage(job.packageId!)}><Check size={14} />{c("设为稳定版", "Set as stable")}</button> : job.packageStatus === "stable" ? <span className="package-stable"><Check size={14} />{c("稳定版", "Stable")}</span> : null}
              {job.artifacts.filter((artifact) => artifact.artifactRole).sort((left) => left.artifactRole === "complete-image" ? -1 : 1).map((artifact) => <a key={artifact.id} href={buildArtifactUrl(job.id, artifact.id)} download><Download size={14} />{artifact.artifactRole === "complete-image" ? c("下载完整固件", "Download complete firmware") : c("下载应用固件", "Download application firmware")}</a>)}
              {["queued", "leased", "running"].includes(job.status) ? <button type="button" aria-label={c(`取消 ${job.name}`, `Cancel ${job.name}`)} onClick={() => void cancelBuildJob(job.id).then(refresh)}><Square size={14} />{c("取消", "Cancel")}</button> : null}
            </div>
            {job.artifacts.find((artifact) => artifact.artifactRole === "complete-image" && artifact.name === "cardputer_adv_complete.bin") ? <CardputerInitialInstall artifact={job.artifacts.find((artifact) => artifact.artifactRole === "complete-image" && artifact.name === "cardputer_adv_complete.bin")!} isEnglish={isEnglish} /> : null}
            {job.artifacts.some((artifact) => !artifact.artifactRole) ? <details className="build-artifact-details"><summary>{c("构建详情", "Build details")}<span>{job.artifacts.filter((artifact) => !artifact.artifactRole).length} {c("个高级制品", "advanced artifacts")}</span></summary><div>{job.artifacts.filter((artifact) => !artifact.artifactRole).map((artifact) => <a key={artifact.id} href={buildArtifactUrl(job.id, artifact.id)} download><Download size={14} /><span><strong>{artifact.name}</strong><small>{artifact.kind.toUpperCase()} · {formatArtifactSize(artifact.size, locale)}</small></span></a>)}</div></details> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

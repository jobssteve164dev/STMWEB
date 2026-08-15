#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";

const VERSION = "0.1.0";
const DEFAULT_STATE_DIR = path.join(homedir(), ".local", "state", "stmweb-runner");
const BUILD_IMAGE = process.env.STMWEB_BUILD_IMAGE || "stmweb/compiler:v0.1.0";
const EXPECTED_IMAGE_ID = process.env.STMWEB_BUILD_IMAGE_ID || "";
const allowedProfiles = new Set(["stm32-cmake-gcc-v1"]);
const allowedTargets = new Set(["stm32f103c8", "stm32f103cb"]);

function value(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function loadState(stateDir) {
  try { return JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8")); } catch { return { pendingEvents: [] }; }
}

async function saveState(stateDir, state) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const target = path.join(stateDir, "state.json");
  const temporary = `${target}.new`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
}

async function request(state, route, init = {}) {
  const response = await fetch(new URL(route, state.controlUrl), {
    ...init,
    headers: { ...(state.deviceToken ? { Authorization: `Bearer ${state.deviceToken}` } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `控制面返回 ${response.status}`);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : Buffer.from(await response.arrayBuffer());
}

function capabilities() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 });
  const disk = spawnSync("df", ["-Pm", process.cwd()], { encoding: "utf8", timeout: 5_000 });
  const diskFreeMb = Number(disk.stdout.trim().split(/\s+/).at(-3)) || 0;
  return {
    os: process.platform,
    architecture: process.arch,
    backend: docker.status === 0 && imageReady() ? "docker" : "unavailable",
    environmentVersion: BUILD_IMAGE,
    maxConcurrentBuilds: 1,
    diskFreeMb,
    toolchains: [{ id: "arm-none-eabi-gcc", version: "container-pinned", targets: [...allowedTargets] }],
  };
}

function imageReady() {
  if (!EXPECTED_IMAGE_ID) return false;
  const image = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", BUILD_IMAGE], { encoding: "utf8", timeout: 10_000 });
  return image.status === 0 && image.stdout.trim() === EXPECTED_IMAGE_ID;
}

async function register(args) {
  const controlUrl = value(args, "--url");
  const codeFile = value(args, "--code-file");
  const code = codeFile ? (await readFile(codeFile, "utf8")).trim() : value(args, "--code");
  const stateDir = value(args, "--state-dir", DEFAULT_STATE_DIR);
  const name = value(args, "--name", hostname());
  if (!controlUrl || !code) throw new Error("register 需要 --url 和配对凭证");
  const current = await loadState(stateDir);
  if (current.deviceToken) throw new Error("这台节点已经注册；转移工作区前请先正式解绑");
  const response = await request({ controlUrl }, "/api/runner/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, capabilities: capabilities() }),
  });
  await saveState(stateDir, { controlUrl, runnerId: response.runnerId, deviceToken: response.deviceToken, activeJob: null, pendingEvents: [] });
  process.stdout.write(`编译算力已连接：${name}\n`);
}

async function sendEvents(stateDir, state, jobId, leaseId, events) {
  const queued = { jobId, leaseId, events };
  state.pendingEvents.push(queued);
  await saveState(stateDir, state);
  await flushEvents(stateDir, state);
}

async function flushEvents(stateDir, state) {
  while (state.pendingEvents.length) {
    const item = state.pendingEvents[0];
    await request(state, `/api/runner/jobs/${item.jobId}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseId: item.leaseId, events: item.events }),
    });
    state.pendingEvents.shift();
    await saveState(stateDir, state);
  }
}

function event(jobId, type, message, payload = {}) {
  return { eventId: `${jobId}-${type}-${randomUUID()}`, type, message, payload };
}

async function uploadArtifact(state, job, file, kind) {
  const content = await readFile(file);
  const name = path.basename(file);
  await request(state, `/api/runner/jobs/${job.id}/artifacts/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "X-Lease-Id": job.leaseId, "X-Artifact-Kind": kind, "X-Content-SHA256": sha256(content) },
    body: content,
  });
  return { name, kind, sha256: sha256(content), size: content.length };
}

async function execute(stateDir, state, job) {
  if (!allowedProfiles.has(job.profile) || !allowedTargets.has(job.target)) throw new Error("Runner 不支持该构建配置");
  const root = await mkdtemp(path.join(tmpdir(), `stmweb-build-${job.id.slice(0, 8)}-`));
  const archive = path.join(root, "source.zip");
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  try {
    await mkdir(source); await mkdir(output);
    const bytes = await request(state, job.sourceUrl);
    if (sha256(bytes) !== job.sourceSha256) throw new Error("源码包摘要不匹配");
    await writeFile(archive, bytes, { mode: 0o600 });
    const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8", timeout: 10_000 });
    if (listing.status !== 0 || listing.stdout.split("\n").some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) {
      throw new Error("源码包包含不安全的文件路径");
    }
    const unpack = spawnSync("unzip", ["-q", archive, "-d", source], { encoding: "utf8", timeout: 30_000 });
    if (unpack.status !== 0) throw new Error("源码包无法解压");
    const cmake = path.join(source, "CMakeLists.txt");
    let cmakeSource = "/source";
    let sourceOptions = "";
    const hasCmake = await stat(cmake).then(() => true).catch(() => false);
    if (!hasCmake) {
      const project = spawnSync("find", [source, "-type", "f", "-path", "*/USER/DOT.uvprojx", "-print", "-quit"], { encoding: "utf8", timeout: 10_000 }).stdout.trim();
      if (!project) throw new Error("无法识别源码工程；请上传 CMake 工程或受支持的 Keil 工程");
      const projectRoot = path.dirname(path.dirname(project));
      const projectDefinition = await readFile(project, "utf8");
      if (!projectDefinition.includes("<Device>STM32F103CB</Device>") || !projectDefinition.includes("..\\DOT\\CONTROL\\control.c")) {
        throw new Error("Keil 工程与 DOT V1 适配器不匹配");
      }
      const relativeRoot = path.relative(source, projectRoot);
      if (relativeRoot.startsWith("..")) throw new Error("源码工程路径无效");
      cmakeSource = "/opt/stmweb/adapters/dot-v1";
      sourceOptions = ` -DSTMWEB_SOURCE_ROOT=${shellQuote(`/source/${relativeRoot.replaceAll("\\", "/")}`)}`;
    }
    if (!imageReady()) throw new Error("编译环境尚未由 GitOps Agent 正确安装或内容校验失败");
    await sendEvents(stateDir, state, job.id, job.leaseId, [event(job.id, "accepted", "Runner 已接收并校验源码"), event(job.id, "started", "开始编译")]);
    const args = [
      "run", "--rm", "--network", "none", "--cpus", "1", "--memory", "1g", "--pids-limit", "256",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
      "-v", `${source}:/source:ro`, "-v", `${output}:/output:rw`,
      BUILD_IMAGE, "sh", "-lc",
      `cmake -S ${cmakeSource} -B /output/build -G Ninja -DSTMWEB_TARGET=${job.target}${sourceOptions} && cmake --build /output/build --parallel 1`,
    ];
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const log = [];
    const capture = (chunk) => { const text = String(chunk).replace(/Bearer\s+[A-Za-z0-9_-]+/g, "Bearer [REDACTED]"); log.push(text); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    let cancelled = false;
    const controlTimer = setInterval(() => {
      void request(state, "/api/runner/heartbeat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilities: capabilities(), activeJobId: job.id }),
      }).then((heartbeat) => {
        if (heartbeat.controls?.some((control) => control.action === "cancelled")) {
          cancelled = true;
          child.kill("SIGTERM");
        }
      }).catch(() => undefined);
    }, 5_000);
    let status;
    try {
      status = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    } finally {
      clearInterval(controlTimer);
    }
    const logFile = path.join(output, "build.log");
    await writeFile(logFile, log.join("").slice(-2_000_000));
    if (cancelled) {
      await sendEvents(stateDir, state, job.id, job.leaseId, [event(job.id, "cancelled", "构建已按用户请求停止")]);
      return;
    }
    if (status !== 0) throw new Error(`固件编译失败，退出码 ${status}`);
    const candidates = [];
    const find = spawnSync("find", [path.join(output, "build"), "-type", "f", "(", "-name", "*.elf", "-o", "-name", "*.hex", "-o", "-name", "*.bin", "-o", "-name", "*.map", ")"], { encoding: "utf8" });
    for (const file of find.stdout.trim().split("\n").filter(Boolean)) candidates.push(file);
    candidates.push(logFile);
    const artifacts = [];
    for (const file of candidates) {
      const extension = path.extname(file).slice(1).toLowerCase();
      artifacts.push(await uploadArtifact(state, job, file, extension === "log" ? "log" : extension));
    }
    await sendEvents(stateDir, state, job.id, job.leaseId, [event(job.id, "completed", "构建完成", { artifactCount: artifacts.length })]);
  } finally {
    const retainedRoot = path.join(stateDir, "build-history");
    await mkdir(retainedRoot, { recursive: true, mode: 0o700 });
    await rename(root, path.join(retainedRoot, `${job.id}-${Date.now()}`));
  }
}

async function connect(args) {
  const stateDir = value(args, "--state-dir", DEFAULT_STATE_DIR);
  const state = await loadState(stateDir);
  if (!state.deviceToken || !state.controlUrl) throw new Error("Runner 尚未注册");
  for (;;) {
    try {
      await flushEvents(stateDir, state);
      const heartbeat = await request(state, "/api/runner/heartbeat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilities: capabilities(), activeJobId: state.activeJob?.id || null }),
      });
      if (heartbeat.controls?.some((control) => control.action === "cancelled") && state.activeJob) state.cancelRequested = true;
      if (state.activeJob) {
        try { await execute(stateDir, state, state.activeJob); }
        catch (error) { await sendEvents(stateDir, state, state.activeJob.id, state.activeJob.leaseId, [event(state.activeJob.id, "failed", error instanceof Error ? error.message : "构建失败")]); }
        state.activeJob = null; state.cancelRequested = false; await saveState(stateDir, state);
      } else {
        const lease = await request(state, "/api/runner/jobs/lease", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (lease.job) {
          state.activeJob = lease.job;
          await saveState(stateDir, state);
          try { await execute(stateDir, state, lease.job); }
          catch (error) { await sendEvents(stateDir, state, lease.job.id, lease.job.leaseId, [event(lease.job.id, "failed", error instanceof Error ? error.message : "构建失败")]); }
          state.activeJob = null; state.cancelRequested = false; await saveState(stateDir, state);
        }
      }
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} ${error instanceof Error ? error.message : "连接失败"}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "register") await register(args);
  else if (command === "connect") await connect(args);
  else if (command === "doctor") process.stdout.write(`${JSON.stringify({ version: VERSION, capabilities: capabilities() }, null, 2)}\n`);
  else if (command === "version") process.stdout.write(`${VERSION}\n`);
  else throw new Error("用法：stmweb-runner <doctor|register|connect|version>");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Runner 执行失败"}\n`);
  process.exitCode = 1;
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "./database.js";
import { env } from "./env.js";
import { digestRunnerSecret } from "./runner-auth.js";

const router = express.Router();
const uuid = z.string().uuid();
const repository = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/i);
export const STMWEB_CLOUDMCP_TOOLS = [
  {
    name: "list_stmweb_debug_state",
    description: "查看 STMWEB 当前设备台账、在线编译算力、最近固件构建和调试会话。",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "create_stmweb_runner_pairing",
    description: "生成一次性 STMWEB 编译算力接入凭证，供 GitOps 将指定 x86 节点接入固件构建池。",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "start_stmweb_firmware_build",
    description: "从受信任 GitHub 仓库的不可变提交创建一次 STM32 固件构建。",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        runner_id: { type: "string", format: "uuid" },
        repository: { type: "string", description: "owner/repository" },
        source_revision: { type: "string", description: "完整 40 位 Git commit SHA" },
        name: { type: "string", minLength: 1, maxLength: 160 },
        target: { type: "string", enum: ["stm32f103c8", "stm32f103cb"] },
      },
      required: ["runner_id", "repository", "source_revision", "target"],
    },
  },
  {
    name: "get_stmweb_firmware_build",
    description: "读取一次固件构建的状态、事件、错误和制品摘要。",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { build_id: { type: "string", format: "uuid" } }, required: ["build_id"],
    },
  },
  {
    name: "cancel_stmweb_firmware_build",
    description: "取消一次仍在排队或运行的 STMWEB 固件构建。",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { build_id: { type: "string", format: "uuid" } }, required: ["build_id"],
    },
  },
  {
    name: "get_stmweb_debug_session",
    description: "读取一次已记录调试会话及其结构化事件；不创建或伪造硬件连接。",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { session_id: { type: "string", format: "uuid" } }, required: ["session_id"],
    },
  },
] as const;

type Operator = { userId: string; workspaceId: string };

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticate(request: Request): void {
  const clientId = env.CLOUDMCP_BRIDGE_CLIENT_ID;
  const secrets = [env.CLOUDMCP_BRIDGE_CLIENT_SECRET, env.CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT].filter((value): value is string => Boolean(value));
  if (!clientId || secrets.length === 0) throw Object.assign(new Error("CloudMCP provider bridge is not configured"), { status: 503 });
  const declaredClient = request.get("X-CloudMCP-Bridge-Client") || "";
  const authorization = request.get("Authorization") || "";
  if (!safeEqual(declaredClient, clientId) || !secrets.some((secret) => safeEqual(authorization, `Bearer ${secret}`))) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
}

async function operator(): Promise<Operator> {
  const result = await pool.query<Operator>(
    `SELECT u.id AS "userId", w.id AS "workspaceId"
     FROM internal_users u
     JOIN workspace_members wm ON wm.user_id=u.id AND wm.role IN ('owner','editor')
     JOIN workspaces w ON w.id=wm.workspace_id
     WHERE u.username=$1 AND u.enabled=true
     ORDER BY w.created_at ASC LIMIT 1`,
    [env.STMWEB_ADMIN_USERNAME.toLowerCase()],
  );
  if (!result.rows[0]) throw Object.assign(new Error("CloudMCP 操作员还没有可写工作区"), { status: 409 });
  return result.rows[0];
}

function allowedRepositories(): Set<string> {
  return new Set(env.STMWEB_CLOUDMCP_SOURCE_REPOSITORIES.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

async function fetchSourceArchive(repo: string, sourceRevision: string): Promise<Buffer> {
  if (!allowedRepositories().has(repo.toLowerCase())) throw Object.assign(new Error("源码仓库未获 STMWEB 编译授权"), { status: 403 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`https://codeload.github.com/${repo}/zip/${sourceRevision}`, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw Object.assign(new Error(`无法读取源码提交（HTTP ${response.status}）`), { status: 422 });
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (declaredSize > 16 * 1024 * 1024) throw Object.assign(new Error("源码归档超过 16 MiB"), { status: 413 });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw Object.assign(new Error("源码归档为空或超过 16 MiB"), { status: 413 });
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

async function listState(identity: Operator) {
  const [devices, runners, builds, sessions] = await Promise.all([
    pool.query(`SELECT id,name,model,board,firmware_version AS "firmwareVersion",updated_at AS "updatedAt" FROM devices WHERE workspace_id=$1 ORDER BY updated_at DESC`, [identity.workspaceId]),
    pool.query(`SELECT id,name,capabilities,CASE WHEN last_seen_at < now()-interval '45 seconds' THEN 'offline' ELSE status END AS status,current_job_id AS "currentJobId",last_seen_at AS "lastSeenAt" FROM build_runners WHERE workspace_id=$1 AND revoked=false ORDER BY created_at DESC`, [identity.workspaceId]),
    pool.query(`SELECT j.id,j.name,j.target,j.status,j.progress,j.error,j.source_name AS "sourceName",j.source_sha256 AS "sourceSha256",j.created_at AS "createdAt",j.finished_at AS "finishedAt",r.name AS "runnerName" FROM build_jobs j JOIN build_runners r ON r.id=j.runner_id WHERE j.workspace_id=$1 ORDER BY j.created_at DESC LIMIT 20`, [identity.workspaceId]),
    pool.query(`SELECT id,device_id AS "deviceId",device_name AS "deviceName",connection_label AS "connectionLabel",status,event_count AS "eventCount",is_demo AS "isDemo",started_at AS "startedAt",ended_at AS "endedAt" FROM debug_sessions WHERE workspace_id=$1 ORDER BY started_at DESC LIMIT 20`, [identity.workspaceId]),
  ]);
  return { devices: devices.rows, build_runners: runners.rows, firmware_builds: builds.rows, debug_sessions: sessions.rows };
}

async function createPairing(identity: Operator) {
  if (!env.STMWEB_BUILD_IMAGE_ID) throw Object.assign(new Error("编译环境尚未通过 GitOps Agent 发布到节点"), { status: 409 });
  const code = randomBytes(12).toString("base64url").toUpperCase().replace(/[-_]/g, "").slice(0, 12);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await pool.query(`INSERT INTO runner_pairing_codes (workspace_id,code_hash,expires_at,created_by) VALUES ($1,$2,$3,$4)`, [identity.workspaceId, digestRunnerSecret(code), expiresAt, identity.userId]);
  return { pairing_code: code, expires_at: expiresAt.toISOString(), build_image: env.STMWEB_BUILD_IMAGE, build_image_id: env.STMWEB_BUILD_IMAGE_ID };
}

async function startBuild(identity: Operator, params: unknown) {
  const input = z.object({ runner_id: uuid, repository, source_revision: revision, name: z.string().trim().min(1).max(160).optional(), target: z.enum(["stm32f103c8", "stm32f103cb"]) }).parse(params);
  const runner = await pool.query(`SELECT id FROM build_runners WHERE id=$1 AND workspace_id=$2 AND revoked=false AND last_seen_at>=now()-interval '45 seconds'`, [input.runner_id, identity.workspaceId]);
  if (!runner.rowCount) throw Object.assign(new Error("指定编译算力不在线或不属于当前工作区"), { status: 409 });
  const source = await fetchSourceArchive(input.repository, input.source_revision.toLowerCase());
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const sourceName = `${input.repository.replace("/", "-")}-${input.source_revision.slice(0, 12)}.zip`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO build_jobs (workspace_id,runner_id,created_by,name,profile,target,source_name,source_sha256,source_content)
     VALUES ($1,$2,$3,$4,'stm32-cmake-gcc-v1',$5,$6,$7,$8) RETURNING id`,
    [identity.workspaceId, input.runner_id, identity.userId, input.name || `固件 ${input.source_revision.slice(0, 12)}`, input.target, sourceName, sourceSha256, source],
  );
  return { build_id: result.rows[0].id, status: "queued", repository: input.repository, source_revision: input.source_revision.toLowerCase(), source_sha256: sourceSha256, target: input.target };
}

async function getBuild(identity: Operator, params: unknown) {
  const { build_id } = z.object({ build_id: uuid }).parse(params);
  const build = await pool.query(
    `SELECT j.id,j.name,j.profile,j.target,j.status,j.progress,j.error,j.source_name AS "sourceName",j.source_sha256 AS "sourceSha256",j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",r.id AS "runnerId",r.name AS "runnerName",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'sha256',a.sha256,'size',a.size) ORDER BY a.created_at) FROM build_artifacts a WHERE a.job_id=j.id),'[]'::jsonb) AS artifacts
     FROM build_jobs j JOIN build_runners r ON r.id=j.runner_id WHERE j.id=$1 AND j.workspace_id=$2`,
    [build_id, identity.workspaceId],
  );
  if (!build.rows[0]) throw Object.assign(new Error("固件构建不存在"), { status: 404 });
  const events = await pool.query(`SELECT event_id AS "eventId",type,message,payload,created_at AS "createdAt" FROM build_events WHERE job_id=$1 ORDER BY created_at`, [build_id]);
  return { ...build.rows[0], events: events.rows };
}

async function cancelBuild(identity: Operator, params: unknown) {
  const { build_id } = z.object({ build_id: uuid }).parse(params);
  const result = await pool.query<{ status: string }>(
    `UPDATE build_jobs SET desired_state='cancelled',status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
     WHERE id=$1 AND workspace_id=$2 AND status NOT IN ('succeeded','failed','cancelled') RETURNING status`,
    [build_id, identity.workspaceId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("构建已经结束或不存在"), { status: 409 });
  return { build_id, desired_state: "cancelled", status: result.rows[0].status };
}

async function getDebugSession(identity: Operator, params: unknown) {
  const { session_id } = z.object({ session_id: uuid }).parse(params);
  const session = await pool.query(`SELECT id,device_id AS "deviceId",device_name AS "deviceName",connection_label AS "connectionLabel",status,event_count AS "eventCount",is_demo AS "isDemo",started_at AS "startedAt",ended_at AS "endedAt" FROM debug_sessions WHERE id=$1 AND workspace_id=$2`, [session_id, identity.workspaceId]);
  if (!session.rows[0]) throw Object.assign(new Error("调试会话不存在"), { status: 404 });
  const events = await pool.query(`SELECT id,sequence,recorded_at AS "recordedAt",level,message,payload FROM debug_events WHERE session_id=$1 ORDER BY sequence`, [session_id]);
  return { session: session.rows[0], events: events.rows };
}

router.get(["/help", "/v1/help"], (_request, response) => {
  response.json({
    object: "stmweb_provider_bridge_help",
    provider: { bridgeId: "stmweb_hardware", providerId: "stmweb_hardware", providerName: "STMWEB Hardware", routePath: "/api/provider-bridge" },
    auth: { mode: "cloudmcp_provider_env_v1" },
    protocol: { requestShape: { tool: "string", params: {} }, successShape: { success: true, result: "any" }, failureShape: { success: false, error: "string" } },
    tools: STMWEB_CLOUDMCP_TOOLS,
    boundaries: { browserHardwareRequired: true, remoteFlashAvailable: false },
  });
});

router.post("/", express.json({ limit: "64kb" }), async (request, response) => {
  try {
    authenticate(request);
    const body = z.object({ tool: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    const identity = await operator();
    let result: unknown;
    if (body.tool === "list_tools") result = STMWEB_CLOUDMCP_TOOLS;
    else if (body.tool === "list_stmweb_debug_state") result = await listState(identity);
    else if (body.tool === "create_stmweb_runner_pairing") result = await createPairing(identity);
    else if (body.tool === "start_stmweb_firmware_build") result = await startBuild(identity, body.params);
    else if (body.tool === "get_stmweb_firmware_build") result = await getBuild(identity, body.params);
    else if (body.tool === "cancel_stmweb_firmware_build") result = await cancelBuild(identity, body.params);
    else if (body.tool === "get_stmweb_debug_session") result = await getDebugSession(identity, body.params);
    else throw Object.assign(new Error(`Unknown tool: ${body.tool}`), { status: 404 });
    response.json({ success: true, result });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : (typeof error === "object" && error && "status" in error ? Number(error.status) : 500);
    response.status(status).json({ success: false, error: status === 500 ? "STMWEB provider bridge 暂时不可用" : (error as Error).message });
  }
});

router.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => response.status(500).json({ success: false, error: "STMWEB provider bridge 暂时不可用" }));

export { router as cloudmcpProviderRouter };

import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { pool, withTransaction } from "./database.js";
import { env } from "./env.js";
import { requireInternalSession } from "./internal-auth.js";
import { digestRunnerSecret } from "./runner-auth.js";

interface AuthenticatedRequest extends Request {
  currentUser: { id: string; username: string; name: string };
}

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 1 },
});
const sourceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 1 } });

const uuid = z.string().uuid();
const sessionSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  deviceId: uuid.nullable().optional(),
  deviceName: z.string().trim().min(1).max(160),
  connectionLabel: z.string().trim().min(1).max(160),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: z.enum(["recording", "completed", "interrupted"]),
  eventCount: z.number().int().min(0),
  isDemo: z.boolean(),
});
const eventSchema = z.object({
  id: uuid,
  sessionId: uuid,
  sequence: z.number().int().min(0),
  recordedAt: z.string().datetime(),
  level: z.enum(["info", "success", "warning", "data"]),
  message: z.string().min(1).max(20_000),
  payload: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
});
const workbenchComponent = z.enum([
  "orientation", "camera", "motor", "battery", "chart", "terminal", "controls", "events", "firmware",
]);
const profileKey = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function verifyOrigin(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (origin !== new URL(env.BETTER_AUTH_URL).origin) {
    response.status(403).json({ error: "请求来源未获授权" });
    return;
  }
  next();
}

async function requireWorkspace(
  userId: string,
  workspaceId: string,
  writable = false,
): Promise<void> {
  const result = await pool.query<{ role: string }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || (writable && role === "viewer")) {
    const error = new Error("无权访问此工作区") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

router.use(verifyOrigin);
router.use(requireInternalSession);
router.use(express.json({ limit: "1mb" }));

router.get("/me", (request, response) => {
  response.json({ user: (request as AuthenticatedRequest).currentUser });
});

router.get("/bootstrap", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const result = await withTransaction(async (client) => {
    let workspaces = await client.query(
      `SELECT w.id, w.name, w.slug, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1
       ORDER BY w.created_at ASC`,
      [user.id],
    );
    if (workspaces.rowCount === 0) {
      const created = await client.query<{ id: string }>(
        `INSERT INTO workspaces (name, slug, owner_user_id)
         VALUES ($1, $2, $3) RETURNING id`,
        ["我的硬件工作区", `personal-${user.id.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 32)}`, user.id],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [created.rows[0].id, user.id],
      );
      workspaces = await client.query(
        `SELECT w.id, w.name, w.slug, wm.role
         FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1 ORDER BY w.created_at ASC`,
        [user.id],
      );
    }
    return workspaces.rows;
  });
  response.json({ user, workspaces: result });
}));

router.get("/workspaces/:workspaceId/devices", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id, workspace_id AS "workspaceId", name, model, board, clock, flash, location,
            firmware_version AS "version", note
     FROM devices WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [workspaceId],
  );
  response.json({ devices: result.rows });
}));

router.post("/workspaces/:workspaceId/devices", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  const input = z.object({
    name: z.string().trim().min(1).max(160),
    model: z.string().trim().max(120).default(""),
    board: z.string().trim().max(120).default(""),
    clock: z.string().trim().max(80).default(""),
    flash: z.string().trim().max(80).default(""),
    location: z.string().trim().max(160).default(""),
    version: z.string().trim().max(120).default(""),
    note: z.string().trim().max(1000).default(""),
  }).parse(request.body);
  const result = await pool.query(
    `INSERT INTO devices (workspace_id, name, model, board, clock, flash, location, firmware_version, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, workspace_id AS "workspaceId", name, model, board, clock, flash, location,
               firmware_version AS "version", note`,
    [workspaceId, input.name, input.model, input.board, input.clock, input.flash, input.location, input.version, input.note],
  );
  response.status(201).json({ device: result.rows[0] });
}));

router.get("/workspaces/:workspaceId/firmware", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id, workspace_id AS "workspaceId", file_name AS "fileName", file_size::bigint::text AS "fileSize",
            file_type AS "fileType", sha256, created_at AS "createdAt"
     FROM firmware_versions WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  response.json({ firmware: result.rows.map((row) => ({ ...row, fileSize: Number(row.fileSize) })) });
}));

router.post("/workspaces/:workspaceId/firmware", upload.single("file"), asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!request.file) {
    response.status(400).json({ error: "请选择固件文件" });
    return;
  }
  const sha256 = z.string().regex(/^[a-f0-9]{64}$/).parse(request.body.sha256);
  const fileType = z.string().trim().min(1).max(32).parse(request.body.fileType);
  const result = await pool.query(
    `INSERT INTO firmware_versions
       (workspace_id, uploaded_by, file_name, file_size, file_type, sha256, content)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (workspace_id, sha256) DO UPDATE SET file_name = EXCLUDED.file_name
     RETURNING id, workspace_id AS "workspaceId", file_name AS "fileName", file_size::bigint::text AS "fileSize",
               file_type AS "fileType", sha256, created_at AS "createdAt"`,
    [workspaceId, user.id, request.file.originalname, request.file.size, fileType, sha256, request.file.buffer],
  );
  response.status(201).json({ firmware: { ...result.rows[0], fileSize: Number(result.rows[0].fileSize) } });
}));

router.get("/workspaces/:workspaceId/sessions", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id, workspace_id AS "projectId", device_id AS "deviceId", device_name AS "deviceName",
            connection_label AS "connectionLabel", started_at AS "startedAt", ended_at AS "endedAt",
            status, event_count AS "eventCount", is_demo AS "isDemo"
     FROM debug_sessions WHERE workspace_id = $1 ORDER BY started_at DESC`,
    [workspaceId],
  );
  response.json({ sessions: result.rows });
}));

router.put("/sessions/:sessionId", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const input = sessionSchema.parse({ ...request.body, id: request.params.sessionId });
  await requireWorkspace(user.id, input.workspaceId, true);
  await pool.query(
    `INSERT INTO debug_sessions
       (id, workspace_id, device_id, created_by, device_name, connection_label, started_at, ended_at, status, event_count, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET ended_at=EXCLUDED.ended_at, status=EXCLUDED.status,
       event_count=EXCLUDED.event_count, updated_at=now()
     WHERE debug_sessions.workspace_id=EXCLUDED.workspace_id`,
    [input.id, input.workspaceId, input.deviceId ?? null, user.id, input.deviceName, input.connectionLabel,
      input.startedAt, input.endedAt ?? null, input.status, input.eventCount, input.isDemo],
  );
  response.json({ success: true });
}));

router.get("/sessions/:sessionId/events", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const sessionId = uuid.parse(request.params.sessionId);
  const access = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM debug_sessions WHERE id = $1`, [sessionId],
  );
  if (!access.rows[0]) {
    response.status(404).json({ error: "调试会话不存在" });
    return;
  }
  await requireWorkspace(user.id, access.rows[0].workspace_id);
  const result = await pool.query(
    `SELECT id, session_id AS "sessionId", sequence, recorded_at AS "recordedAt", level, message, payload
     FROM debug_events WHERE session_id = $1 ORDER BY sequence ASC`,
    [sessionId],
  );
  response.json({ events: result.rows });
}));

router.post("/sessions/:sessionId/events", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const input = eventSchema.parse({ ...request.body, sessionId: request.params.sessionId });
  const access = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM debug_sessions WHERE id = $1`, [input.sessionId],
  );
  if (!access.rows[0]) {
    response.status(404).json({ error: "调试会话不存在" });
    return;
  }
  await requireWorkspace(user.id, access.rows[0].workspace_id, true);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO debug_events (id, session_id, sequence, recorded_at, level, message, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.sessionId, input.sequence, input.recordedAt, input.level, input.message, input.payload ?? null],
    );
    await client.query(
      `UPDATE debug_sessions SET event_count = GREATEST(event_count, $2), updated_at = now() WHERE id = $1`,
      [input.sessionId, input.sequence + 1],
    );
  });
  response.status(201).json({ success: true });
}));

router.get("/workspaces/:workspaceId/workbench/:profileKey", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const key = profileKey.parse(request.params.profileKey);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query<{ selectedComponents: string[] }>(
    `SELECT selected_components AS "selectedComponents"
     FROM workbench_preferences WHERE workspace_id = $1 AND profile_key = $2`,
    [workspaceId, key],
  );
  response.json({ selectedComponents: result.rows[0]?.selectedComponents ?? null });
}));

router.put("/workspaces/:workspaceId/workbench/:profileKey", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const key = profileKey.parse(request.params.profileKey);
  const selectedComponents = z.array(workbenchComponent).max(20).parse(request.body.selectedComponents);
  await requireWorkspace(user.id, workspaceId, true);
  await pool.query(
    `INSERT INTO workbench_preferences (workspace_id, profile_key, selected_components, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (workspace_id, profile_key) DO UPDATE
       SET selected_components = EXCLUDED.selected_components, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [workspaceId, key, JSON.stringify(selectedComponents), user.id],
  );
  response.json({ success: true });
}));

router.get("/workspaces/:workspaceId/runners", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id,name,capabilities,
       CASE WHEN last_seen_at < now()-interval '45 seconds' THEN 'offline' ELSE status END AS status,
       current_job_id AS "currentJobId",last_seen_at AS "lastSeenAt",created_at AS "createdAt"
     FROM build_runners WHERE workspace_id=$1 AND revoked=false ORDER BY created_at DESC`,
    [workspaceId],
  );
  response.json({ runners: result.rows });
}));

router.post("/workspaces/:workspaceId/runners/pairing", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!env.STMWEB_BUILD_IMAGE_ID) {
    response.status(409).json({ error: "编译环境尚未通过 GitOps Agent 发布到节点" });
    return;
  }
  const code = randomBytes(12).toString("base64url").toUpperCase().replace(/[-_]/g, "").slice(0, 12);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await pool.query(
    `INSERT INTO runner_pairing_codes (workspace_id,code_hash,expires_at,created_by) VALUES ($1,$2,$3,$4)`,
    [workspaceId,digestRunnerSecret(code),expiresAt,user.id],
  );
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  response.status(201).json({
    code,
    expiresAt: expiresAt.toISOString(),
    command: `curl -fsSL ${shellArgument(`${origin}/install-runner.sh`)} | sudo bash -s -- --url ${shellArgument(origin)} --code ${shellArgument(code)} --image ${shellArgument(env.STMWEB_BUILD_IMAGE)} --image-id ${shellArgument(env.STMWEB_BUILD_IMAGE_ID)}`,
  });
}));

router.get("/workspaces/:workspaceId/builds", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT j.id,j.runner_id AS "runnerId",r.name AS "runnerName",j.name,j.profile,j.target,j.source_name AS "sourceName",
       j.source_sha256 AS "sourceSha256",j.status,j.progress,j.error,j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'sha256',a.sha256,'size',a.size) ORDER BY a.created_at) FROM build_artifacts a WHERE a.job_id=j.id),'[]'::jsonb) AS artifacts
     FROM build_jobs j JOIN build_runners r ON r.id=j.runner_id WHERE j.workspace_id=$1 ORDER BY j.created_at DESC LIMIT 100`,
    [workspaceId],
  );
  response.json({ builds: result.rows });
}));

router.post("/workspaces/:workspaceId/builds", sourceUpload.single("source"), asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!request.file) { response.status(400).json({ error: "请选择 ZIP 源码包" }); return; }
  const input = z.object({
    runnerId: uuid,
    name: z.string().trim().min(1).max(160),
    profile: z.literal("stm32-cmake-gcc-v1"),
    target: z.enum(["stm32f103c8", "stm32f103cb"]),
  }).parse(request.body);
  const runner = await pool.query(
    `SELECT id FROM build_runners WHERE id=$1 AND workspace_id=$2 AND revoked=false AND last_seen_at>=now()-interval '45 seconds'`,
    [input.runnerId,workspaceId],
  );
  if (!runner.rowCount) { response.status(409).json({ error: "请选择在线的编译算力" }); return; }
  const sha256 = createHash("sha256").update(request.file.buffer).digest("hex");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO build_jobs (workspace_id,runner_id,created_by,name,profile,target,source_name,source_sha256,source_content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [workspaceId,input.runnerId,user.id,input.name,input.profile,input.target,request.file.originalname,sha256,request.file.buffer],
  );
  response.status(201).json({ id: result.rows[0].id, sha256 });
}));

router.post("/workspaces/:workspaceId/builds/:jobId/cancel", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const jobId = uuid.parse(request.params.jobId);
  await requireWorkspace(user.id, workspaceId, true);
  const result = await pool.query(
    `UPDATE build_jobs SET desired_state='cancelled',status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
       finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
     WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','leased','running') RETURNING id`,
    [jobId,workspaceId],
  );
  if (!result.rowCount) { response.status(409).json({ error: "构建已经结束或不存在" }); return; }
  response.json({ success: true });
}));

router.get("/workspaces/:workspaceId/builds/:jobId/events", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const jobId = uuid.parse(request.params.jobId);
  await requireWorkspace(user.id, workspaceId);
  const access = await pool.query(`SELECT id FROM build_jobs WHERE id=$1 AND workspace_id=$2`,[jobId,workspaceId]);
  if (!access.rowCount) { response.status(404).json({ error: "构建不存在" }); return; }
  const events = await pool.query(`SELECT event_id AS "eventId",type,message,payload,created_at AS "createdAt" FROM build_events WHERE job_id=$1 ORDER BY created_at`,[jobId]);
  response.json({ events: events.rows });
}));

router.get("/workspaces/:workspaceId/builds/:jobId/artifacts/:artifactId", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const jobId = uuid.parse(request.params.jobId);
  const artifactId = uuid.parse(request.params.artifactId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query<{ name: string; content: Buffer; sha256: string }>(
    `SELECT a.name,a.content,a.sha256 FROM build_artifacts a JOIN build_jobs j ON j.id=a.job_id
     WHERE a.id=$1 AND a.job_id=$2 AND j.workspace_id=$3`,[artifactId,jobId,workspaceId],
  );
  const artifact = result.rows[0];
  if (!artifact) { response.status(404).json({ error: "构建制品不存在" }); return; }
  response.set({ "Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${encodeURIComponent(artifact.name)}"`,"X-Content-SHA256":artifact.sha256 });
  response.send(artifact.content);
}));

router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "提交的数据格式不正确", fields: error.flatten().fieldErrors });
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "上传文件超过大小限制" : "文件上传失败" });
    return;
  }
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  response.status(status).json({ error: status === 500 ? "服务暂时不可用" : (error as Error).message });
});

export { router as apiRouter };

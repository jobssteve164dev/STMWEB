import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { pool, withTransaction } from "./database.js";
import { env } from "./env.js";
import { digestRunnerSecret } from "./runner-auth.js";
import { requireConnectionScope, requireConnectionWorkspace, requireUserOrApiConnection, type AuthenticatedApiRequest } from "./api-connection-auth.js";
import { hasStmwebProAccess } from "./passport.js";
import { prepareFirmwareUpload } from "./firmware-artifact.js";
import { getFirmwareAdapterTarget, listFirmwareAdapterTargets, resolveFirmwareConfiguration } from "./firmware-adapter-registry.js";

interface AuthenticatedRequest extends Request {
  currentUser: { id: string; username: string; name: string; email: string; passportUserId: string };
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

router.use(requireUserOrApiConnection);
router.use(requireConnectionScope);
router.use(express.json({ limit: "1mb" }));
router.use(asyncRoute(async (request, response, next) => {
  if (!/^\/workspaces\/[^/]+\/(hardware-projects|firmware-packages|runners|builds)(?:\/|$)/.test(request.path)) return next();
  const user = (request as AuthenticatedRequest).currentUser;
  const allowed = await hasStmwebProAccess({ id: user.passportUserId, email: user.email });
  if (!allowed) {
    response.status(403).json({ error: "连接编译算力和创建固件构建需要 Pro 计划", code: "pro_required" });
    return;
  }
  next();
}));

router.get("/me", (request, response) => {
  response.json({ user: (request as AuthenticatedRequest).currentUser });
});

router.get("/bootstrap", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const apiConnection = (request as AuthenticatedApiRequest).apiConnection;
  const result = await withTransaction(async (client) => {
    let workspaces = await client.query(
      `SELECT w.id, w.name, w.slug, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1 AND ($2::uuid IS NULL OR w.id = $2)
       ORDER BY w.created_at ASC`,
      [user.id, apiConnection?.workspaceId ?? null],
    );
    if (workspaces.rowCount === 0 && !apiConnection) {
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
  let pro = false;
  let accessStatus: "ready" | "unavailable" = "ready";
  try {
    pro = await hasStmwebProAccess({ id: user.passportUserId, email: user.email });
  } catch {
    accessStatus = "unavailable";
  }
  response.json({ user, workspaces: result, planAccess: { tier: pro ? "pro" : "free", pro, status: accessStatus } });
}));

router.get("/workspaces/:workspaceId/devices", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id, workspace_id AS "workspaceId", name, model, board, clock, flash, location,
            firmware_version AS "version", note, updated_at AS "updatedAt"
     FROM devices WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [workspaceId],
  );
  response.json({ devices: result.rows });
}));

router.post("/workspaces/:workspaceId/devices", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
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

router.get("/workspaces/:workspaceId/hardware-projects/templates", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  response.json({ templates: listFirmwareAdapterTargets() });
}));

router.get("/workspaces/:workspaceId/hardware-projects", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id,name,hardware_profile_id AS "hardwareProfileId",adapter_version AS "adapterVersion",
            runtime_version AS "runtimeVersion",target,firmware_configuration AS "firmwareConfiguration",status,created_at AS "createdAt"
     FROM hardware_projects WHERE workspace_id=$1 AND status='active' ORDER BY created_at DESC`,
    [workspaceId],
  );
  response.json({ hardwareProjects: result.rows.map((project) => {
    const registered = getFirmwareAdapterTarget(project.hardwareProfileId, project.adapterVersion, project.target);
    const saved = project.firmwareConfiguration as { capabilityModules?: unknown; connectionModules?: unknown } | null;
    const selected = saved && Array.isArray(saved.capabilityModules) && Array.isArray(saved.connectionModules)
      ? [...saved.capabilityModules, ...saved.connectionModules].filter((item): item is string => typeof item === "string")
      : undefined;
    return { ...project, firmwareConfiguration: registered ? resolveFirmwareConfiguration(registered.adapter, registered.target, selected) : {
      schemaVersion: 2, foundationModules: [], capabilityModules: [], connectionModules: [], flashMethods: [], runtimeTransports: [], components: [],
      portBindings: [], resourceBindings: [], buildFeatures: [], compositionSha256: "",
    } };
  }) });
}));

router.post("/workspaces/:workspaceId/hardware-projects", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  const input = z.object({
    name: z.string().trim().min(1).max(160),
    hardwareProfileId: z.string().min(1).max(160),
    adapterVersion: z.string().min(1).max(40),
    target: z.string().min(1).max(80),
    selectedModuleIds: z.array(z.string().min(1).max(120)).max(40),
  }).parse(request.body);
  const registered = getFirmwareAdapterTarget(input.hardwareProfileId, input.adapterVersion, input.target);
  if (!registered) { response.status(400).json({ error: "请选择平台已经验证的硬件模板" }); return; }
  let firmwareConfiguration;
  try { firmwareConfiguration = resolveFirmwareConfiguration(registered.adapter, registered.target, input.selectedModuleIds); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "固件模块配置不可用" }); return; }
  const result = await pool.query(
    `INSERT INTO hardware_projects (workspace_id,created_by,name,hardware_profile_id,adapter_version,runtime_version,target,firmware_configuration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (workspace_id,name) DO NOTHING
     RETURNING id,name,hardware_profile_id AS "hardwareProfileId",adapter_version AS "adapterVersion",
       runtime_version AS "runtimeVersion",target,firmware_configuration AS "firmwareConfiguration",status,created_at AS "createdAt"`,
    [workspaceId, user.id, input.name, registered.adapter.adapterId, registered.adapter.adapterVersion, registered.adapter.runtimeVersion, registered.target.id, JSON.stringify(firmwareConfiguration)],
  );
  if (!result.rows[0]) { response.status(409).json({ error: "这个硬件项目名称已经存在" }); return; }
  response.status(201).json({ hardwareProject: result.rows[0] });
}));

router.post("/workspaces/:workspaceId/firmware-packages/:packageId/stable", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const packageId = uuid.parse(request.params.packageId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  const selected = await withTransaction(async (client) => {
    const result = await client.query<{ hardwareProjectId: string }>(
      `SELECT hardware_project_id AS "hardwareProjectId" FROM firmware_packages
       WHERE id=$1 AND workspace_id=$2 AND status IN ('verified','stable') FOR UPDATE`,
      [packageId, workspaceId],
    );
    const firmwarePackage = result.rows[0];
    if (!firmwarePackage) return null;
    await client.query(`SELECT id FROM hardware_projects WHERE id=$1 FOR UPDATE`, [firmwarePackage.hardwareProjectId]);
    await client.query(
      `UPDATE firmware_packages SET status='verified'
       WHERE workspace_id=$1 AND hardware_project_id=$2 AND status='stable' AND id<>$3`,
      [workspaceId, firmwarePackage.hardwareProjectId, packageId],
    );
    await client.query(`UPDATE firmware_packages SET status='stable' WHERE id=$1`, [packageId]);
    return firmwarePackage;
  });
  if (!selected) { response.status(404).json({ error: "这份固件包不存在或已停用" }); return; }
  response.json({ success: true, packageId, status: "stable" });
}));

router.get("/workspaces/:workspaceId/firmware", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT * FROM (
       SELECT f.id,f.workspace_id AS "workspaceId",f.file_name AS "fileName",f.file_size::bigint::text AS "fileSize",
              f.file_type AS "fileType",f.sha256,f.hardware_profile_id AS "hardwareProfileId",
              f.artifact_role AS "artifactRole",f.flash_methods AS "flashMethods",f.flash_size AS "flashSize",
              f.application_base AS "applicationBase",f.application_limit AS "applicationLimit",
              f.runtime_version AS "runtimeVersion",f.status,NULL::uuid AS "packageId",NULL::text AS "packageName",
              NULL::text AS "hardwareProjectName",f.created_at AS "createdAt"
       FROM firmware_versions f WHERE f.workspace_id=$1
       UNION ALL
       SELECT a.id,p.workspace_id,a.file_name,a.file_size::bigint::text,a.file_type,a.sha256,p.hardware_profile_id,
              a.artifact_role,a.flash_methods,a.flash_size,a.application_base,a.application_limit,p.runtime_version,p.status,
              p.id,p.name,h.name,a.created_at
       FROM firmware_package_artifacts a
       JOIN firmware_packages p ON p.id=a.package_id
       JOIN hardware_projects h ON h.id=p.hardware_project_id
       WHERE p.workspace_id=$1
     ) firmware ORDER BY "createdAt" DESC`,
    [workspaceId],
  );
  response.json({ firmware: result.rows.map((row) => ({ ...row, fileSize: Number(row.fileSize) })) });
}));

router.post("/workspaces/:workspaceId/firmware", upload.single("file"), asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!request.file) {
    response.status(400).json({ error: "请选择固件文件" });
    return;
  }
  let prepared;
  try {
    const clientSha256 = request.body.sha256 ? z.string().regex(/^[a-f0-9]{64}$/).parse(request.body.sha256) : undefined;
    prepared = prepareFirmwareUpload(request.file.buffer, request.file.originalname, clientSha256);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "固件文件无法验证" });
    return;
  }
  const result = await pool.query(
    `INSERT INTO firmware_versions
       (workspace_id, uploaded_by, file_name, file_size, file_type, sha256, content,
        hardware_profile_id,artifact_role,flash_methods,flash_size,application_base,application_limit,runtime_version,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (workspace_id, sha256) DO UPDATE SET
       file_name=EXCLUDED.file_name,file_size=EXCLUDED.file_size,file_type=EXCLUDED.file_type,content=EXCLUDED.content,
       hardware_profile_id=EXCLUDED.hardware_profile_id,artifact_role=EXCLUDED.artifact_role,
       flash_methods=EXCLUDED.flash_methods,flash_size=EXCLUDED.flash_size,
       application_base=EXCLUDED.application_base,application_limit=EXCLUDED.application_limit,
       runtime_version=EXCLUDED.runtime_version,status=EXCLUDED.status
     RETURNING id, workspace_id AS "workspaceId", file_name AS "fileName", file_size::bigint::text AS "fileSize",
               file_type AS "fileType", sha256, hardware_profile_id AS "hardwareProfileId",
               artifact_role AS "artifactRole", flash_methods AS "flashMethods", flash_size AS "flashSize",
               application_base AS "applicationBase", application_limit AS "applicationLimit",
               runtime_version AS "runtimeVersion", status, created_at AS "createdAt"`,
    [workspaceId, user.id, request.file.originalname, request.file.size, prepared.fileType, prepared.sha256, request.file.buffer,
      prepared.hardwareProfileId, prepared.artifactRole, prepared.flashMethods, prepared.flashSize,
      prepared.applicationBase, prepared.applicationLimit, prepared.runtimeVersion, prepared.status],
  );
  response.status(201).json({ firmware: { ...result.rows[0], fileSize: Number(result.rows[0].fileSize) } });
}));

router.get("/workspaces/:workspaceId/firmware/:firmwareId/content", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const firmwareId = uuid.parse(request.params.firmwareId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query<{ fileName: string; content: Buffer; sha256: string }>(
    `SELECT file_name AS "fileName",content,sha256 FROM firmware_versions WHERE id=$1 AND workspace_id=$2
     UNION ALL
     SELECT a.file_name,a.content,a.sha256 FROM firmware_package_artifacts a
       JOIN firmware_packages p ON p.id=a.package_id WHERE a.id=$1 AND p.workspace_id=$2`,
    [firmwareId, workspaceId],
  );
  const firmware = result.rows[0];
  if (!firmware) { response.status(404).json({ error: "固件制品不存在" }); return; }
  response.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(firmware.fileName)}"`,
    "X-Content-SHA256": firmware.sha256,
  });
  response.send(firmware.content);
}));

router.get("/workspaces/:workspaceId/sessions", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
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

router.get("/workspaces/:workspaceId/sessions/:sessionId", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const sessionId = uuid.parse(request.params.sessionId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT id,device_id AS "deviceId",device_name AS "deviceName",connection_label AS "connectionLabel",
            status,event_count AS "eventCount",is_demo AS "isDemo",started_at AS "startedAt",ended_at AS "endedAt"
     FROM debug_sessions WHERE id=$1 AND workspace_id=$2`,
    [sessionId, workspaceId],
  );
  if (!result.rows[0]) { response.status(404).json({ error: "调试会话不存在" }); return; }
  response.json({ session: result.rows[0] });
}));

router.put("/sessions/:sessionId", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const input = sessionSchema.parse({ ...request.body, id: request.params.sessionId });
  requireConnectionWorkspace(request, input.workspaceId);
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
  requireConnectionWorkspace(request, access.rows[0].workspace_id);
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
  requireConnectionWorkspace(request, access.rows[0].workspace_id);
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
  requireConnectionWorkspace(request, workspaceId);
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
  requireConnectionWorkspace(request, workspaceId);
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
  requireConnectionWorkspace(request, workspaceId);
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
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!env.STMWEB_BUILD_IMAGE_ID) {
    response.status(409).json({ error: "编译环境尚未发布到节点" });
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
    buildImage: env.STMWEB_BUILD_IMAGE,
    buildImageId: env.STMWEB_BUILD_IMAGE_ID,
    command: `curl -fsSL ${shellArgument(`${origin}/install-runner.sh`)} | sudo bash -s -- --url ${shellArgument(origin)} --code ${shellArgument(code)} --image ${shellArgument(env.STMWEB_BUILD_IMAGE)} --image-id ${shellArgument(env.STMWEB_BUILD_IMAGE_ID)}`,
  });
}));

router.get("/workspaces/:workspaceId/builds", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT j.id,j.runner_id AS "runnerId",r.name AS "runnerName",j.name,j.profile,j.target,j.source_name AS "sourceName",
       h.id AS "hardwareProjectId",h.name AS "hardwareProjectName",p.id AS "packageId",p.status AS "packageStatus",
       j.source_sha256 AS "sourceSha256",j.status,j.progress,j.error,j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'sha256',a.sha256,'size',a.size,'artifactRole',(SELECT pa.artifact_role FROM firmware_package_artifacts pa WHERE pa.package_id=p.id AND pa.file_name=a.name LIMIT 1)) ORDER BY a.created_at) FROM build_artifacts a WHERE a.job_id=j.id),'[]'::jsonb) AS artifacts
     FROM build_jobs j JOIN build_runners r ON r.id=j.runner_id
       LEFT JOIN hardware_projects h ON h.id=j.hardware_project_id LEFT JOIN firmware_packages p ON p.build_job_id=j.id
     WHERE j.workspace_id=$1 ORDER BY j.created_at DESC LIMIT 100`,
    [workspaceId],
  );
  response.json({ builds: result.rows });
}));

router.get("/workspaces/:workspaceId/builds/:jobId", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  const jobId = uuid.parse(request.params.jobId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId);
  const result = await pool.query(
    `SELECT j.id,j.runner_id AS "runnerId",r.name AS "runnerName",j.name,j.profile,j.target,j.source_name AS "sourceName",
       h.id AS "hardwareProjectId",h.name AS "hardwareProjectName",p.id AS "packageId",p.status AS "packageStatus",
       j.source_sha256 AS "sourceSha256",j.status,j.progress,j.error,j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'sha256',a.sha256,'size',a.size,'artifactRole',(SELECT pa.artifact_role FROM firmware_package_artifacts pa WHERE pa.package_id=p.id AND pa.file_name=a.name LIMIT 1)) ORDER BY a.created_at) FROM build_artifacts a WHERE a.job_id=j.id),'[]'::jsonb) AS artifacts
     FROM build_jobs j JOIN build_runners r ON r.id=j.runner_id
       LEFT JOIN hardware_projects h ON h.id=j.hardware_project_id LEFT JOIN firmware_packages p ON p.build_job_id=j.id
     WHERE j.id=$1 AND j.workspace_id=$2`,
    [jobId, workspaceId],
  );
  if (!result.rows[0]) { response.status(404).json({ error: "构建不存在" }); return; }
  response.json({ build: result.rows[0] });
}));

router.post("/workspaces/:workspaceId/builds", sourceUpload.single("source"), asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  await requireWorkspace(user.id, workspaceId, true);
  if (!request.file) { response.status(400).json({ error: "请选择 ZIP 源码包" }); return; }
  const input = z.object({
    runnerId: uuid,
    name: z.string().trim().min(1).max(160),
    profile: z.literal("stm32-cmake-gcc-v1"),
    hardwareProjectId: uuid.optional(),
    target: z.enum(["stm32f103c8", "stm32f103cb"]).optional(),
  }).refine((value) => value.hardwareProjectId || value.target, { message: "请选择硬件项目" }).parse(request.body);
  const runner = await pool.query(
    `SELECT id FROM build_runners
     WHERE id=$1 AND workspace_id=$2 AND revoked=false AND last_seen_at>=now()-interval '45 seconds'
       AND capabilities->>'firmwareCompositionVersion'='2'`,
    [input.runnerId,workspaceId],
  );
  if (!runner.rowCount) { response.status(409).json({ error: "请选择已更新且在线的编译算力" }); return; }
  let hardwareProject = input.hardwareProjectId ? (await pool.query<{
    id: string; hardwareProfileId: string; adapterVersion: string; runtimeVersion: string; target: string; firmwareConfiguration: unknown;
  }>(
    `SELECT id,hardware_profile_id AS "hardwareProfileId",adapter_version AS "adapterVersion",runtime_version AS "runtimeVersion",target,firmware_configuration AS "firmwareConfiguration"
     FROM hardware_projects WHERE id=$1 AND workspace_id=$2 AND status='active'`,
    [input.hardwareProjectId, workspaceId],
  )).rows[0] : undefined;
  if (!hardwareProject && input.target) {
    const template = getFirmwareAdapterTarget("stmweb.dot-v1", "1", input.target);
    if (!template) { response.status(400).json({ error: "目标硬件尚未完成平台适配" }); return; }
    const created = await pool.query<{
      id: string; hardwareProfileId: string; adapterVersion: string; runtimeVersion: string; target: string; firmwareConfiguration: unknown;
    }>(
      `INSERT INTO hardware_projects (workspace_id,created_by,name,hardware_profile_id,adapter_version,runtime_version,target)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id,name) DO UPDATE SET updated_at=now()
       RETURNING id,hardware_profile_id AS "hardwareProfileId",adapter_version AS "adapterVersion",runtime_version AS "runtimeVersion",target,firmware_configuration AS "firmwareConfiguration"`,
      [workspaceId, user.id, `${template.adapter.label} · ${template.target.label}`, template.adapter.adapterId,
        template.adapter.adapterVersion, template.adapter.runtimeVersion, template.target.id],
    );
    hardwareProject = created.rows[0];
  }
  if (!hardwareProject) { response.status(400).json({ error: "请选择当前工作区中的硬件项目" }); return; }
  const registered = getFirmwareAdapterTarget(hardwareProject.hardwareProfileId, hardwareProject.adapterVersion, hardwareProject.target);
  if (!registered || registered.adapter.runtimeVersion !== hardwareProject.runtimeVersion || registered.adapter.buildProfile !== input.profile) {
    response.status(409).json({ error: "硬件项目使用的适配版本当前不可生成" }); return;
  }
  const savedConfiguration = hardwareProject.firmwareConfiguration as { capabilityModules?: unknown; connectionModules?: unknown } | null;
  const selectedModuleIds = savedConfiguration && Array.isArray(savedConfiguration.capabilityModules) && Array.isArray(savedConfiguration.connectionModules)
    ? [...savedConfiguration.capabilityModules, ...savedConfiguration.connectionModules].filter((item): item is string => typeof item === "string")
    : undefined;
  let firmwareConfiguration;
  try { firmwareConfiguration = resolveFirmwareConfiguration(registered.adapter, registered.target, selectedModuleIds); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "硬件项目的固件配置已不可用" }); return; }
  const sha256 = createHash("sha256").update(request.file.buffer).digest("hex");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO build_jobs
       (workspace_id,runner_id,hardware_project_id,created_by,name,profile,target,adapter_version,runtime_version,firmware_configuration,source_name,source_sha256,source_content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING id`,
    [workspaceId,input.runnerId,hardwareProject.id,user.id,input.name,input.profile,hardwareProject.target,
      hardwareProject.adapterVersion,hardwareProject.runtimeVersion,JSON.stringify(firmwareConfiguration),request.file.originalname,sha256,request.file.buffer],
  );
  response.status(201).json({ id: result.rows[0].id, sha256 });
}));

router.post("/workspaces/:workspaceId/builds/:jobId/cancel", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
  const jobId = uuid.parse(request.params.jobId);
  await requireWorkspace(user.id, workspaceId, true);
  const result = await pool.query<{ id: string; status: string }>(
    `UPDATE build_jobs SET desired_state='cancelled',status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
       finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
     WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','leased','running') RETURNING id,status`,
    [jobId,workspaceId],
  );
  if (!result.rowCount) { response.status(409).json({ error: "构建已经结束或不存在" }); return; }
  response.json({ success: true, build: { id: result.rows[0].id, status: result.rows[0].status, desiredState: "cancelled" } });
}));

router.get("/workspaces/:workspaceId/builds/:jobId/events", asyncRoute(async (request, response) => {
  const user = (request as AuthenticatedRequest).currentUser;
  const workspaceId = uuid.parse(request.params.workspaceId);
  requireConnectionWorkspace(request, workspaceId);
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
  requireConnectionWorkspace(request, workspaceId);
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

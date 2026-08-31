import { randomBytes, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool, withTransaction } from "./database.js";
import { digestRunnerSecret, requireRunner, type RunnerRequest } from "./runner-auth.js";
import { registerGeneratedFirmwarePackage } from "./firmware-package-registration.js";
import { getFirmwareAdapterTarget } from "./firmware-adapter-registry.js";

const router = express.Router();
const capabilitiesSchema = z.object({
  os: z.string().max(32),
  architecture: z.string().max(32),
  backend: z.string().max(64),
  environmentVersion: z.string().max(120),
  maxConcurrentBuilds: z.number().int().min(1).max(4).default(1),
  firmwareCompositionVersion: z.literal(2).optional(),
  supportedAdapterTargets: z.array(z.object({
    hardwareProfileId: z.string().max(120),
    adapterVersion: z.string().max(80),
    target: z.string().max(80),
  })).max(64).default([]),
  toolchains: z.array(z.object({ id: z.string().max(80), version: z.string().max(80), targets: z.array(z.string().max(80)).max(32) })).max(16),
  diskFreeMb: z.number().int().min(0).optional(),
});
const pairSchema = z.object({ code: z.string().min(6).max(32), name: z.string().trim().min(1).max(120), capabilities: capabilitiesSchema });
const heartbeatSchema = z.object({ capabilities: capabilitiesSchema, activeJobId: z.string().uuid().nullable() });
const eventSchema = z.object({
  eventId: z.string().min(1).max(120),
  type: z.enum(["accepted", "started", "progress", "log", "completed", "failed", "cancelled"]),
  message: z.string().max(20_000).optional(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);
}

router.use(express.json({ limit: "2mb" }));

router.post("/pair", asyncRoute(async (request, response) => {
  const input = pairSchema.parse(request.body);
  const codeHash = digestRunnerSecret(input.code);
  const result = await withTransaction(async (client) => {
    const pairing = await client.query<{ id: string; workspaceId: string; expiresAt: Date; usedAt: Date | null }>(
      `SELECT id, workspace_id AS "workspaceId", expires_at AS "expiresAt", used_at AS "usedAt"
       FROM runner_pairing_codes WHERE code_hash = $1 FOR UPDATE`,
      [codeHash],
    );
    const code = pairing.rows[0];
    if (!code || code.usedAt || code.expiresAt.getTime() <= Date.now()) return null;
    const token = randomBytes(32).toString("base64url");
    const runner = await client.query<{ id: string }>(
      `INSERT INTO build_runners (workspace_id, name, token_hash, capabilities, status, last_seen_at)
       VALUES ($1,$2,$3,$4::jsonb,'online',now()) RETURNING id`,
      [code.workspaceId, input.name, digestRunnerSecret(token), JSON.stringify(input.capabilities)],
    );
    await client.query(`UPDATE runner_pairing_codes SET used_at = now() WHERE id = $1`, [code.id]);
    return { runnerId: runner.rows[0].id, deviceToken: token };
  });
  if (!result) {
    response.status(400).json({ error: "配对码无效、已使用或已过期" });
    return;
  }
  response.status(201).json(result);
}));

router.use(requireRunner);

router.post("/heartbeat", asyncRoute(async (request, response) => {
  const runner = (request as RunnerRequest).runnerIdentity;
  const input = heartbeatSchema.parse(request.body);
  await pool.query(
    `UPDATE build_runners SET capabilities=$2::jsonb, last_seen_at=now(), current_job_id=$3,
       status=CASE WHEN $3::uuid IS NULL THEN 'online' ELSE 'busy' END WHERE id=$1`,
    [runner.id, JSON.stringify(input.capabilities), input.activeJobId],
  );
  const controls = input.activeJobId
    ? (await pool.query<{ action: string }>(
        `SELECT desired_state AS action FROM build_jobs WHERE id=$1 AND runner_id=$2 AND desired_state='cancelled'`,
        [input.activeJobId, runner.id],
      )).rows
    : [];
  response.json({ runnerId: runner.id, controls });
}));

router.post("/jobs/lease", asyncRoute(async (request, response) => {
  const runner = (request as RunnerRequest).runnerIdentity;
  const lease = await withTransaction(async (client) => {
    const active = await client.query(`SELECT id FROM build_jobs WHERE runner_id=$1 AND status IN ('leased','running') LIMIT 1`, [runner.id]);
    if (active.rowCount) return null;
    const queued = await client.query<{ id: string; name: string; profile: string; target: string; sourceName: string; sourceSha256: string; hardwareProfileId: string; adapterVersion: string; runtimeVersion: string; firmwareConfiguration: unknown }>(
      `SELECT j.id,j.name,j.profile,j.target,j.source_name AS "sourceName",j.source_sha256 AS "sourceSha256",
              p.hardware_profile_id AS "hardwareProfileId",j.adapter_version AS "adapterVersion",j.runtime_version AS "runtimeVersion",
              j.firmware_configuration AS "firmwareConfiguration"
       FROM build_jobs j JOIN hardware_projects p ON p.id=j.hardware_project_id
       WHERE j.runner_id=$1 AND j.status='queued' AND j.desired_state='running'
         AND EXISTS (
           SELECT 1 FROM build_runners r
           WHERE r.id=$1 AND r.capabilities->>'firmwareCompositionVersion'='2' AND r.capabilities->>'backend'='docker'
             AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(COALESCE(r.capabilities->'supportedAdapterTargets','[]'::jsonb)) supported
               WHERE supported->>'hardwareProfileId'=p.hardware_profile_id
                 AND supported->>'adapterVersion'=j.adapter_version AND supported->>'target'=j.target
             )
         )
       ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
      [runner.id],
    );
    const job = queued.rows[0];
    if (!job) return null;
    const registered = getFirmwareAdapterTarget(job.hardwareProfileId, job.adapterVersion, job.target);
    if (!registered || registered.adapter.runtimeVersion !== job.runtimeVersion || registered.adapter.buildProfile !== job.profile) {
      throw new Error("排队任务引用的固件适配器已经不可用");
    }
    const leaseId = randomUUID();
    await client.query(`UPDATE build_jobs SET status='leased', lease_id=$2, leased_at=now(), updated_at=now() WHERE id=$1`, [job.id, leaseId]);
    await client.query(`UPDATE build_runners SET current_job_id=$2, status='busy', last_seen_at=now() WHERE id=$1`, [runner.id, job.id]);
    return { ...job, adapterBuildDirectory: registered.adapter.buildDirectory, leaseId, sourceUrl: `/api/runner/jobs/${job.id}/source` };
  });
  response.json({ job: lease });
}));

router.get("/jobs/:jobId/source", asyncRoute(async (request, response) => {
  const runner = (request as RunnerRequest).runnerIdentity;
  const result = await pool.query<{ sourceContent: Buffer; sourceName: string; sourceSha256: string }>(
    `SELECT source_content AS "sourceContent", source_name AS "sourceName", source_sha256 AS "sourceSha256"
     FROM build_jobs WHERE id=$1 AND runner_id=$2 AND status IN ('leased','running')`,
    [request.params.jobId, runner.id],
  );
  const source = result.rows[0];
  if (!source) { response.status(404).json({ error: "构建源码不可用" }); return; }
  response.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${encodeURIComponent(source.sourceName)}"`, "X-Content-SHA256": source.sourceSha256 });
  response.send(source.sourceContent);
}));

router.post("/jobs/:jobId/events", asyncRoute(async (request, response) => {
  const runner = (request as RunnerRequest).runnerIdentity;
  const body = z.object({ leaseId: z.string().uuid(), events: z.array(eventSchema).min(1).max(100) }).parse(request.body);
  const accepted = await withTransaction(async (client) => {
    const jobResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM build_jobs WHERE id=$1 AND runner_id=$2 AND lease_id=$3 FOR UPDATE`,
      [request.params.jobId, runner.id, body.leaseId],
    );
    const job = jobResult.rows[0];
    if (!job) return false;
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return true;
    for (const event of body.events) {
      await client.query(
        `INSERT INTO build_events (job_id,event_id,type,message,payload) VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (event_id) DO NOTHING`,
        [request.params.jobId, event.eventId, event.type, event.message ?? null, JSON.stringify(event.payload)],
      );
      if (event.type === "accepted") await client.query(`UPDATE build_jobs SET status='running', started_at=COALESCE(started_at,now()), updated_at=now() WHERE id=$1`, [request.params.jobId]);
      if (event.type === "progress") await client.query(`UPDATE build_jobs SET progress=$2, updated_at=now() WHERE id=$1`, [request.params.jobId, Math.max(0, Math.min(100, Number(event.payload.progress ?? 0)))]);
      if (["completed", "failed", "cancelled"].includes(event.type)) {
        if (event.type === "completed") await registerGeneratedFirmwarePackage(client, String(request.params.jobId));
        const status = event.type === "completed" ? "succeeded" : event.type;
        await client.query(`UPDATE build_jobs SET status=$2, progress=CASE WHEN $2='succeeded' THEN 100 ELSE progress END, finished_at=now(), error=$3, updated_at=now() WHERE id=$1`, [request.params.jobId, status, event.type === "failed" ? event.message ?? "构建失败" : null]);
        await client.query(`UPDATE build_runners SET current_job_id=NULL, status='online', last_seen_at=now() WHERE id=$1`, [runner.id]);
        break;
      }
    }
    return true;
  });
  if (!accepted) { response.status(409).json({ error: "任务租约已失效" }); return; }
  response.status(201).json({ success: true });
}));

router.put("/jobs/:jobId/artifacts/:name", express.raw({ type: "application/octet-stream", limit: "32mb" }), asyncRoute(async (request, response) => {
  const runner = (request as RunnerRequest).runnerIdentity;
  const leaseId = z.string().uuid().parse(request.get("x-lease-id"));
  const kind = z.enum(["elf", "hex", "bin", "map", "log", "report"]).parse(request.get("x-artifact-kind"));
  const expectedHash = z.string().regex(/^[a-f0-9]{64}$/).parse(request.get("x-content-sha256"));
  const content = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(content).digest("hex") !== expectedHash) { response.status(400).json({ error: "制品摘要不匹配" }); return; }
  const access = await pool.query(`SELECT id FROM build_jobs WHERE id=$1 AND runner_id=$2 AND lease_id=$3`, [request.params.jobId, runner.id, leaseId]);
  if (!access.rowCount) { response.status(409).json({ error: "任务租约已失效" }); return; }
  await pool.query(
    `INSERT INTO build_artifacts (job_id,name,kind,sha256,size,content) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (job_id,name) DO UPDATE SET kind=EXCLUDED.kind,sha256=EXCLUDED.sha256,size=EXCLUDED.size,content=EXCLUDED.content`,
    [request.params.jobId, request.params.name, kind, expectedHash, content.length, content],
  );
  response.status(201).json({ success: true });
}));

router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) { response.status(400).json({ error: "Runner 提交的数据格式不正确" }); return; }
  console.error("Runner API request failed", error);
  response.status(500).json({ error: "编译算力服务暂时不可用" });
});

export { router as runnerApiRouter };

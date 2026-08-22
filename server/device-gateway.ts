import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { pool, withTransaction } from "./database.js";
import {
  requireConnectionScope,
  requireConnectionWorkspace,
  requireUserOrApiConnection,
  type AuthenticatedApiRequest,
} from "./api-connection-auth.js";

type JsonObject = Record<string, unknown>;
type OperationStatus = "queued" | "leased" | "accepted" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "expired";

interface ProviderRequest extends Request {
  deviceProvider: { id: string; workspaceId: string };
}

export const DEVICE_GATEWAY_OPENAPI = {
  openapi: "3.1.0",
  info: { title: "STMWEB Device Gateway API", version: "1.0.0", description: "工作区隔离的设备注册、授权调用和可靠执行公共契约。" },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      userApi: { type: "http", scheme: "bearer", bearerFormat: "stmweb_api credential" },
      deviceProvider: { type: "http", scheme: "bearer", bearerFormat: "stmweb_device credential" },
    },
    schemas: {
      DeviceOperation: { type: "object", required: ["id", "deviceId", "action", "status", "createdAt", "expiresAt"], properties: {
        id: { type: "string", format: "uuid" }, deviceId: { type: "string", format: "uuid" }, action: { type: "string" },
        status: { type: "string", enum: ["queued", "leased", "accepted", "running", "cancelling", "succeeded", "failed", "cancelled", "expired"] },
        createdAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, result: { type: ["object", "null"] },
      } },
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, code: { type: "string" } } },
    },
  },
  paths: {
    "/api/v1/workspaces/{workspaceId}/device-enrollments": { post: { summary: "创建设备注册", security: [{ userApi: [] }], responses: { "201": { description: "一次性注册材料" } } } },
    "/api/device/v1/enrollments/exchange": { post: { summary: "交换设备机器凭证", responses: { "201": { description: "机器凭证，仅返回一次" } } } },
    "/api/device/v1/devices": { post: { summary: "注册或更新设备", security: [{ deviceProvider: [] }], responses: { "201": { description: "设备" } } } },
    "/api/device/v1/credentials/rotate": { post: { summary: "轮换设备机器凭证", security: [{ deviceProvider: [] }], responses: { "200": { description: "新机器凭证，仅返回一次" } } } },
    "/api/device/v1/heartbeat": { post: { summary: "上报设备在线心跳", security: [{ deviceProvider: [] }], responses: { "200": { description: "已接收" } } } },
    "/api/device/v1/devices/{deviceId}/capabilities": { put: { summary: "发布版本化能力声明", security: [{ deviceProvider: [] }], responses: { "200": { description: "已保存" } } } },
    "/api/device/v1/operations/lease": { post: { summary: "长轮询领取操作", security: [{ deviceProvider: [] }], responses: { "200": { description: "操作或空结果" } } } },
    "/api/device/v1/operations/{operationId}/renew": { post: { summary: "续租操作", security: [{ deviceProvider: [] }], responses: { "200": { description: "已续租" } } } },
    "/api/device/v1/operations/{operationId}/events": { post: { summary: "回报有序事件和真实结果", security: [{ deviceProvider: [] }], responses: { "200": { description: "已接收或幂等重放" } } } },
    "/api/v1/workspaces/{workspaceId}/devices": { get: { summary: "列出设备", security: [{ userApi: [] }], responses: { "200": { description: "设备列表" } } } },
    "/api/v1/workspaces/{workspaceId}/devices/{deviceId}": { get: { summary: "读取设备", security: [{ userApi: [] }], responses: { "200": { description: "设备" } } } },
    "/api/v1/workspaces/{workspaceId}/devices/{deviceId}/capabilities": { get: { summary: "读取设备能力", security: [{ userApi: [] }], responses: { "200": { description: "能力声明" } } } },
    "/api/v1/workspaces/{workspaceId}/devices/{deviceId}/operations": { post: { summary: "创建设备调用", security: [{ userApi: [] }], parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], responses: { "201": { description: "已接受调用" } } } },
    "/api/v1/workspaces/{workspaceId}/device-operations/{operationId}": { get: { summary: "读取调用状态和结果", security: [{ userApi: [] }], responses: { "200": { description: "操作资源" } } } },
    "/api/v1/workspaces/{workspaceId}/device-operations/{operationId}/events": { get: { summary: "读取调用事件", security: [{ userApi: [] }], responses: { "200": { description: "有序事件" } } } },
    "/api/v1/workspaces/{workspaceId}/device-operations/{operationId}/cancel": { post: { summary: "请求取消调用", security: [{ userApi: [] }], responses: { "200": { description: "取消状态" } } } },
  },
} as const;

const uuid = z.string().uuid();
const actionName = z.string().trim().min(1).max(160).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const jsonObject = z.record(z.string(), z.unknown());
const terminalStatuses = new Set<OperationStatus>(["succeeded", "failed", "cancelled", "expired"]);
const providerTransitions: Record<OperationStatus, OperationStatus[]> = {
  queued: [],
  leased: ["accepted", "failed"],
  accepted: ["running", "failed", "cancelled"],
  running: ["running", "succeeded", "failed", "cancelled"],
  cancelling: ["cancelled", "succeeded", "failed"],
  succeeded: [], failed: [], cancelled: [], expired: [],
};

const capabilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  manifestVersion: z.string().trim().min(1).max(120),
  device: z.object({
    id: uuid,
    model: z.string().trim().min(1).max(160),
    firmwareVersion: z.string().trim().max(120).default(""),
  }),
  actions: z.array(z.object({
    name: actionName,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    inputSchema: jsonObject,
    resultSchema: jsonObject.optional(),
    defaultTimeoutMs: z.number().int().min(1000).max(300_000),
    maximumTimeoutMs: z.number().int().min(1000).max(300_000),
    interruptible: z.boolean().default(false),
    status: z.enum(["online", "degraded", "unavailable"]).default("online"),
  })).min(1).max(100),
}).superRefine((manifest, context) => {
  const names = new Set<string>();
  for (const [index, action] of manifest.actions.entries()) {
    if (names.has(action.name)) context.addIssue({ code: "custom", path: ["actions", index, "name"], message: "动作名称不能重复" });
    names.add(action.name);
  }
});

function httpError(status: number, message: string, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function enrollmentCode(): string {
  const raw = randomBytes(6).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function normalizedEnrollmentCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function providerCredential(): string {
  return `stmweb_device_${randomBytes(32).toString("base64url")}`;
}

function validateSchemaDefinition(schema: JsonObject, path = "schema"): void {
  const allowedTypes = new Set(["object", "string", "integer", "number", "boolean", "array"]);
  if (typeof schema.type !== "string" || !allowedTypes.has(schema.type)) throw httpError(400, `${path} 缺少受支持的类型`);
  if (schema.type === "object") {
    if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties))) throw httpError(400, `${path}.properties 必须是对象`);
    for (const [name, child] of Object.entries((schema.properties ?? {}) as JsonObject)) {
      if (!child || typeof child !== "object" || Array.isArray(child)) throw httpError(400, `${path}.${name} 定义无效`);
      validateSchemaDefinition(child as JsonObject, `${path}.${name}`);
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string"))) throw httpError(400, `${path}.required 必须是字段名数组`);
  }
  if (schema.type === "array") {
    if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) throw httpError(400, `${path}.items 定义无效`);
    validateSchemaDefinition(schema.items as JsonObject, `${path}.items`);
  }
}

export function validateJsonSchema(value: unknown, schema: JsonObject, path = "参数"): string[] {
  const errors: string[] = [];
  const type = schema.type;
  const isNumber = typeof value === "number" && Number.isFinite(value);
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}必须是对象`];
    const objectValue = value as JsonObject;
    const properties = (schema.properties ?? {}) as JsonObject;
    for (const required of (schema.required ?? []) as string[]) if (!(required in objectValue)) errors.push(`${path}.${required}不能为空`);
    if (schema.additionalProperties === false) for (const key of Object.keys(objectValue)) if (!(key in properties)) errors.push(`${path}.${key}不受支持`);
    for (const [key, child] of Object.entries(properties)) if (key in objectValue) errors.push(...validateJsonSchema(objectValue[key], child as JsonObject, `${path}.${key}`));
  } else if (type === "string") {
    if (typeof value !== "string") errors.push(`${path}必须是文字`);
    else {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}内容太短`);
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}内容太长`);
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}不是允许的选项`);
    }
  } else if (type === "integer") {
    if (!Number.isInteger(value)) errors.push(`${path}必须是整数`);
  } else if (type === "number") {
    if (!isNumber) errors.push(`${path}必须是数字`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path}必须是是或否`);
  } else if (type === "array") {
    if (!Array.isArray(value)) errors.push(`${path}必须是列表`);
    else for (let index = 0; index < value.length; index += 1) errors.push(...validateJsonSchema(value[index], schema.items as JsonObject, `${path}[${index}]`));
  }
  if ((type === "number" || type === "integer") && isNumber) {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}不能大于 ${schema.maximum}`);
  }
  return errors;
}

async function requireWorkspace(userId: string, workspaceId: string, writable = false): Promise<string> {
  const result = await pool.query<{ role: string }>(
    `SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [workspaceId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || (writable && role === "viewer")) throw httpError(403, "无权执行这个工作区操作");
  return role;
}

function operationView(row: Record<string, unknown>) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    action: row.action,
    status: row.status,
    arguments: row.arguments,
    result: row.result,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

async function assertConnectionGrant(request: Request, workspaceId: string, deviceId: string, action?: string, permission = "read"): Promise<void> {
  const connection = (request as AuthenticatedApiRequest).apiConnection;
  if (!connection) return;
  const result = await pool.query<{ actions: string[] }>(
    `SELECT actions FROM device_grants
     WHERE connection_id=$1 AND workspace_id=$2 AND device_id=$3 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at>now()) AND $4=ANY(permissions)`,
    [connection.id, workspaceId, deviceId, permission],
  );
  if (!result.rows[0] || action && !result.rows[0].actions.includes(action)) throw httpError(403, "这个应用未获准调用该设备动作");
}

async function latestManifest(deviceId: string): Promise<{ manifest: z.infer<typeof capabilityManifestSchema> } | null> {
  const result = await pool.query<{ manifest: z.infer<typeof capabilityManifestSchema> }>(
    `SELECT manifest FROM device_capability_manifests WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1`, [deviceId],
  );
  return result.rows[0] ?? null;
}

async function authenticateProvider(request: Request, response: Response, next: NextFunction) {
  try {
    const authorization = request.get("authorization");
    const credential = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!credential.startsWith("stmweb_device_")) return response.status(401).json({ error: "设备凭证无效" });
    const credentialHash = digest(credential);
    const result = await pool.query<{ id: string; workspaceId: string; credentialHash: string }>(
      `SELECT id,workspace_id AS "workspaceId",credential_hash AS "credentialHash"
       FROM device_providers WHERE credential_hash=$1 AND status='active' AND revoked_at IS NULL`, [credentialHash],
    );
    const provider = result.rows[0];
    if (!provider || !safeEqual(provider.credentialHash, credentialHash)) return response.status(401).json({ error: "设备凭证无效或已撤销" });
    (request as unknown as ProviderRequest).deviceProvider = { id: provider.id, workspaceId: provider.workspaceId };
    next();
  } catch (error) { next(error); }
}

export const deviceApiRouter = express.Router();
deviceApiRouter.use(express.json({ limit: "256kb" }));
deviceApiRouter.get("/openapi.json", (_request, response) => response.json(DEVICE_GATEWAY_OPENAPI));

deviceApiRouter.post("/enrollments/exchange", async (request, response, next) => {
  try {
    const input = z.object({ code: z.string().min(8).max(40), providerName: z.string().trim().min(1).max(160).optional() }).parse(request.body);
    const credential = providerCredential();
    const exchanged = await withTransaction(async (client) => {
      const enrollment = await client.query<{ id: string; workspaceId: string; providerName: string; createdBy: string }>(
        `SELECT id,workspace_id AS "workspaceId",provider_name AS "providerName",created_by AS "createdBy"
         FROM device_enrollments WHERE code_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
        [digest(normalizedEnrollmentCode(input.code))],
      );
      const record = enrollment.rows[0];
      if (!record) return null;
      const provider = await client.query<{ id: string }>(
        `INSERT INTO device_providers (workspace_id,name,credential_hash,created_by)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [record.workspaceId, input.providerName ?? record.providerName, digest(credential), record.createdBy],
      );
      await client.query(`UPDATE device_enrollments SET used_at=now() WHERE id=$1`, [record.id]);
      return { providerId: provider.rows[0].id, workspaceId: record.workspaceId };
    });
    if (!exchanged) return response.status(409).json({ error: "配对码无效、已使用或已过期" });
    response.status(201).json({ ...exchanged, credential });
  } catch (error) { next(error); }
});

deviceApiRouter.use(authenticateProvider);

deviceApiRouter.post("/credentials/rotate", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const credential = providerCredential();
    const result = await pool.query(
      `UPDATE device_providers SET credential_hash=$1,credential_version=credential_version+1
       WHERE id=$2 AND workspace_id=$3 AND status='active' RETURNING credential_version AS "credentialVersion"`,
      [digest(credential), provider.id, provider.workspaceId],
    );
    if (!result.rows[0]) throw httpError(409, "设备连接已经撤销");
    response.json({ credential, credentialVersion: result.rows[0].credentialVersion });
  } catch (error) { next(error); }
});

deviceApiRouter.post("/devices", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const input = z.object({
      providerDeviceId: z.string().trim().min(1).max(200),
      name: z.string().trim().min(1).max(160),
      model: z.string().trim().min(1).max(160),
      location: z.string().trim().max(160).default(""),
      firmwareVersion: z.string().trim().max(120).default(""),
    }).parse(request.body);
    const result = await pool.query(
      `INSERT INTO devices (workspace_id,provider_id,provider_device_id,name,model,location,firmware_version,connection_mode,remote_status,last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'remote','online',now())
       ON CONFLICT (provider_id,provider_device_id) WHERE provider_id IS NOT NULL AND provider_device_id IS NOT NULL
       DO UPDATE SET name=EXCLUDED.name,model=EXCLUDED.model,location=EXCLUDED.location,
         firmware_version=EXCLUDED.firmware_version,remote_status='online',last_seen_at=now(),updated_at=now()
       RETURNING id,workspace_id AS "workspaceId",name,model,location,firmware_version AS "firmwareVersion"`,
      [provider.workspaceId, provider.id, input.providerDeviceId, input.name, input.model, input.location, input.firmwareVersion],
    );
    await pool.query(`UPDATE device_providers SET last_seen_at=now() WHERE id=$1`, [provider.id]);
    response.status(201).json({ device: result.rows[0] });
  } catch (error) { next(error); }
});

deviceApiRouter.post("/heartbeat", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const input = z.object({ deviceIds: z.array(uuid).min(1).max(100) }).parse(request.body);
    await withTransaction(async (client) => {
      await client.query(`UPDATE device_providers SET last_seen_at=now() WHERE id=$1`, [provider.id]);
      const updated = await client.query(
        `UPDATE devices SET last_seen_at=now(),remote_status='online',updated_at=now()
         WHERE provider_id=$1 AND workspace_id=$2 AND id=ANY($3::uuid[]) RETURNING id`,
        [provider.id, provider.workspaceId, input.deviceIds],
      );
      if (updated.rowCount !== input.deviceIds.length) throw httpError(403, "包含不属于当前设备连接的设备");
    });
    response.json({ success: true, serverTime: new Date().toISOString() });
  } catch (error) { next(error); }
});

deviceApiRouter.put("/devices/:deviceId/capabilities", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const deviceId = uuid.parse(request.params.deviceId);
    const manifest = capabilityManifestSchema.parse(request.body);
    if (manifest.device.id !== deviceId) throw httpError(400, "能力声明中的设备与请求设备不一致");
    for (const action of manifest.actions) {
      if (action.defaultTimeoutMs > action.maximumTimeoutMs) throw httpError(400, `${action.label} 的默认等待时间超过上限`);
      validateSchemaDefinition(action.inputSchema, `${action.name}.inputSchema`);
      if (action.resultSchema) validateSchemaDefinition(action.resultSchema, `${action.name}.resultSchema`);
    }
    const device = await pool.query(
      `SELECT id FROM devices WHERE id=$1 AND provider_id=$2 AND workspace_id=$3`, [deviceId, provider.id, provider.workspaceId],
    );
    if (!device.rows[0]) throw httpError(404, "设备不存在或不属于当前连接");
    const serialized = JSON.stringify(manifest);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO device_capability_manifests (workspace_id,device_id,manifest_version,manifest_digest,schema_version,manifest)
         VALUES ($1,$2,$3,$4,1,$5::jsonb) ON CONFLICT (device_id,manifest_digest) DO NOTHING`,
        [provider.workspaceId, deviceId, manifest.manifestVersion, digest(serialized), serialized],
      );
      await client.query(
        `UPDATE devices SET capability_version=$1,firmware_version=$2,last_seen_at=now(),remote_status='online',updated_at=now() WHERE id=$3`,
        [manifest.manifestVersion, manifest.device.firmwareVersion, deviceId],
      );
    });
    response.json({ success: true, manifestVersion: manifest.manifestVersion });
  } catch (error) { next(error); }
});

async function expireQueuedOperations(workspaceId: string, providerId?: string): Promise<void> {
  await withTransaction(async (client) => {
    const expired = await client.query<{ id: string; deviceId: string; providerId: string }>(
      `UPDATE device_operations SET status='expired',finished_at=now(),lease_id=NULL,lease_expires_at=NULL
       WHERE workspace_id=$1 AND ($2::uuid IS NULL OR provider_id=$2) AND status='queued' AND expires_at<=now()
       RETURNING id,device_id AS "deviceId",provider_id AS "providerId"`, [workspaceId, providerId ?? null],
    );
    for (const operation of expired.rows) {
      await client.query(
        `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
         VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(sequence)+1,0) FROM device_operation_events WHERE operation_id=$1),'expired','{}'::jsonb)`,
        [operation.id, workspaceId, operation.providerId, `expired:${randomUUID()}`],
      );
      await client.query(`UPDATE devices SET current_operation_id=NULL WHERE id=$1 AND current_operation_id=$2`, [operation.deviceId, operation.id]);
    }
  });
}

async function leaseOperation(provider: { id: string; workspaceId: string }) {
  await expireQueuedOperations(provider.workspaceId, provider.id);
  return withTransaction(async (client) => {
    const requeued = await client.query<{ id: string }>(
      `UPDATE device_operations SET status='queued',lease_id=NULL,leased_at=NULL,lease_expires_at=NULL
       WHERE provider_id=$1 AND status='leased' AND lease_expires_at<=now() AND expires_at>now() RETURNING id`, [provider.id],
    );
    for (const operation of requeued.rows) await client.query(
      `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(sequence)+1,0) FROM device_operation_events WHERE operation_id=$1),'queued','{}'::jsonb)`,
      [operation.id, provider.workspaceId, provider.id, `requeued:${randomUUID()}`],
    );
    const recovering = await client.query(
      `SELECT id,device_id AS "deviceId",action,arguments,status,execution_timeout_ms AS "executionTimeoutMs",
         expires_at AS "expiresAt",lease_id AS "leaseId",lease_expires_at AS "leaseExpiresAt",
         (SELECT COALESCE(max(sequence)+1,0)::integer FROM device_operation_events WHERE operation_id=o.id) AS "nextEventSequence"
       FROM device_operations o WHERE provider_id=$1 AND workspace_id=$2 AND status IN ('accepted','running','cancelling')
       ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
      [provider.id, provider.workspaceId],
    );
    if (recovering.rows[0]) {
      await client.query(`UPDATE device_operations SET lease_expires_at=now()+interval '30 seconds' WHERE id=$1`, [recovering.rows[0].id]);
      return recovering.rows[0];
    }
    const selected = await client.query<{ id: string }>(
      `SELECT o.id FROM device_operations o
       JOIN devices d ON d.id=o.device_id
       WHERE o.provider_id=$1 AND o.workspace_id=$2 AND o.status='queued' AND o.expires_at>now()
         AND d.provider_id=$1
       ORDER BY o.priority DESC,o.created_at ASC FOR UPDATE OF o SKIP LOCKED LIMIT 1`,
      [provider.id, provider.workspaceId],
    );
    if (!selected.rows[0]) return null;
    const leaseId = randomUUID();
    const operation = await client.query(
      `UPDATE device_operations SET status='leased',lease_id=$1,leased_at=now(),lease_expires_at=now()+interval '30 seconds'
       WHERE id=$2 RETURNING id,device_id AS "deviceId",action,arguments,status,execution_timeout_ms AS "executionTimeoutMs",
         expires_at AS "expiresAt",lease_id AS "leaseId",lease_expires_at AS "leaseExpiresAt"`,
      [leaseId, selected.rows[0].id],
    );
    await client.query(
      `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
       SELECT id,workspace_id,provider_id,$1,
         COALESCE((SELECT max(sequence)+1 FROM device_operation_events WHERE operation_id=$2),0),'leased','{}'::jsonb
       FROM device_operations WHERE id=$2`,
      [`lease:${leaseId}`, selected.rows[0].id],
    );
    const sequence = await client.query<{ next: number }>(
      `SELECT COALESCE(max(sequence)+1,0)::integer AS next FROM device_operation_events WHERE operation_id=$1`,
      [selected.rows[0].id],
    );
    return { ...operation.rows[0], nextEventSequence: sequence.rows[0].next };
  });
}

deviceApiRouter.post("/operations/lease", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const { waitMs } = z.object({ waitMs: z.number().int().min(0).max(25_000).default(20_000) }).parse(request.body ?? {});
    const deadline = Date.now() + waitMs;
    let operation = await leaseOperation(provider);
    while (!operation && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now())));
      operation = await leaseOperation(provider);
    }
    await pool.query(`UPDATE device_providers SET last_seen_at=now() WHERE id=$1`, [provider.id]);
    response.json({ operation });
  } catch (error) { next(error); }
});

deviceApiRouter.post("/operations/:operationId/renew", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const operationId = uuid.parse(request.params.operationId);
    const { leaseId } = z.object({ leaseId: uuid }).parse(request.body);
    const result = await pool.query(
      `UPDATE device_operations SET lease_expires_at=LEAST(expires_at,now()+interval '30 seconds')
       WHERE id=$1 AND provider_id=$2 AND workspace_id=$3 AND lease_id=$4
         AND status IN ('leased','accepted','running','cancelling') AND expires_at>now()
       RETURNING lease_expires_at AS "leaseExpiresAt"`,
      [operationId, provider.id, provider.workspaceId, leaseId],
    );
    if (!result.rows[0]) throw httpError(409, "操作租约已经失效");
    response.json(result.rows[0]);
  } catch (error) { next(error); }
});

deviceApiRouter.post("/operations/:operationId/events", async (request, response, next) => {
  try {
    const provider = (request as unknown as ProviderRequest).deviceProvider;
    const operationId = uuid.parse(request.params.operationId);
    const input = z.object({
      leaseId: uuid,
      eventId: z.string().trim().min(1).max(200),
      sequence: z.number().int().min(0),
      status: z.enum(["accepted", "running", "succeeded", "failed", "cancelled"]),
      result: jsonObject.optional(),
      errorCode: z.string().trim().min(1).max(120).optional(),
      errorMessage: z.string().trim().min(1).max(500).optional(),
      payload: jsonObject.default({}),
    }).parse(request.body);
    const operation = await withTransaction(async (client) => {
      const duplicate = await client.query(
        `SELECT e.status FROM device_operation_events e
         JOIN device_operations o ON o.id=e.operation_id
         WHERE e.operation_id=$1 AND e.event_id=$2 AND o.provider_id=$3 AND o.workspace_id=$4 AND o.lease_id=$5`,
        [operationId, input.eventId, provider.id, provider.workspaceId, input.leaseId],
      );
      if (duplicate.rows[0]) return { duplicate: true, status: duplicate.rows[0].status };
      const locked = await client.query<{
        status: OperationStatus; action: string; deviceId: string; manifest: z.infer<typeof capabilityManifestSchema>;
      }>(
        `SELECT o.status,o.action,o.device_id AS "deviceId",m.manifest
         FROM device_operations o
         JOIN LATERAL (SELECT manifest FROM device_capability_manifests WHERE device_id=o.device_id ORDER BY created_at DESC LIMIT 1) m ON true
         WHERE o.id=$1 AND o.provider_id=$2 AND o.workspace_id=$3 AND o.lease_id=$4 FOR UPDATE`,
        [operationId, provider.id, provider.workspaceId, input.leaseId],
      );
      const current = locked.rows[0];
      if (!current) throw httpError(409, "操作租约无效");
      if (!providerTransitions[current.status].includes(input.status)) throw httpError(409, `不能从 ${current.status} 更新为 ${input.status}`);
      const expectedSequence = await client.query<{ next: number }>(
        `SELECT COALESCE(max(sequence)+1,0)::integer AS next FROM device_operation_events WHERE operation_id=$1`, [operationId],
      );
      if (input.sequence !== expectedSequence.rows[0].next) throw httpError(409, `事件序号应为 ${expectedSequence.rows[0].next}`);
      const action = current.manifest.actions.find((item) => item.name === current.action);
      if (input.status === "succeeded" && action?.resultSchema) {
        const errors = validateJsonSchema(input.result ?? {}, action.resultSchema, "结果");
        if (errors.length) throw httpError(400, errors[0]);
      }
      if (input.status === "failed" && !input.errorCode) throw httpError(400, "失败事件必须提供稳定错误码");
      await client.query(
        `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [operationId, provider.workspaceId, provider.id, input.eventId, input.sequence, input.status, JSON.stringify(input.payload)],
      );
      const terminal = terminalStatuses.has(input.status);
      const updated = await client.query(
        `UPDATE device_operations SET status=$1,
           accepted_at=CASE WHEN $1='accepted' THEN COALESCE(accepted_at,now()) ELSE accepted_at END,
           started_at=CASE WHEN $1='running' THEN COALESCE(started_at,now()) ELSE started_at END,
           finished_at=CASE WHEN $2 THEN now() ELSE finished_at END,
           result=CASE WHEN $1='succeeded' THEN $3::jsonb ELSE result END,
           error_code=CASE WHEN $1='failed' THEN $4 ELSE error_code END,
           error_message=CASE WHEN $1='failed' THEN $5 ELSE error_message END
         WHERE id=$6 RETURNING status`,
        [input.status, terminal, JSON.stringify(input.result ?? {}), input.errorCode ?? null, input.errorMessage ?? null, operationId],
      );
      if (terminal) await client.query(`UPDATE devices SET current_operation_id=NULL WHERE id=$1 AND current_operation_id=$2`, [current.deviceId, operationId]);
      return { duplicate: false, status: updated.rows[0].status };
    });
    response.json(operation);
  } catch (error) { next(error); }
});

export const deviceGatewayRouter = express.Router();
const gatewayRoute = /^\/workspaces\/[^/]+\/(?:gateway|device-enrollments|device-providers\/[^/]+\/revoke|device-grants|devices\/[^/]+(?:\/capabilities|\/operations)?|device-operations\/[^/]+(?:\/events|\/cancel)?)$/;
const gatewayJson = express.json({ limit: "256kb" });
deviceGatewayRouter.use((request, response, next) => gatewayRoute.test(request.path) ? requireUserOrApiConnection(request, response, next) : next());
deviceGatewayRouter.use((request, response, next) => gatewayRoute.test(request.path) ? requireConnectionScope(request, response, next) : next());
deviceGatewayRouter.use((request, response, next) => gatewayRoute.test(request.path) ? gatewayJson(request, response, next) : next());

deviceGatewayRouter.get("/workspaces/:workspaceId/gateway", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId);
    await expireQueuedOperations(workspaceId);
    const connection = (request as unknown as AuthenticatedApiRequest).apiConnection;
    const devices = await pool.query(
      `SELECT d.id,d.name,d.model,d.location,d.firmware_version AS "firmwareVersion",d.capability_version AS "capabilityVersion",
         CASE WHEN d.last_seen_at>now()-interval '45 seconds' AND p.status='active' THEN 'online' ELSE 'offline' END AS status,
         d.last_seen_at AS "lastSeenAt",m.manifest
       FROM devices d JOIN device_providers p ON p.id=d.provider_id
       LEFT JOIN LATERAL (SELECT manifest FROM device_capability_manifests WHERE device_id=d.id ORDER BY created_at DESC LIMIT 1) m ON true
       WHERE d.workspace_id=$1 AND d.connection_mode='remote'
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM device_grants g WHERE g.connection_id=$2 AND g.device_id=d.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())))
       ORDER BY d.updated_at DESC`,
      [workspaceId, connection?.id ?? null],
    );
    const operations = await pool.query(
      `SELECT o.id,o.device_id AS "deviceId",d.name AS "deviceName",o.action,o.status,o.arguments,o.result,o.error_code AS "errorCode",
         o.error_message AS "errorMessage",o.created_at AS "createdAt",o.expires_at AS "expiresAt",o.accepted_at AS "acceptedAt",
         o.started_at AS "startedAt",o.finished_at AS "finishedAt"
       FROM device_operations o JOIN devices d ON d.id=o.device_id
       WHERE o.workspace_id=$1 AND ($2::uuid IS NULL OR o.connection_id=$2)
       ORDER BY o.created_at DESC LIMIT 50`,
      [workspaceId, connection?.id ?? null],
    );
    const connections = connection ? { rows: [] } : await pool.query(
      `SELECT id,name,scopes FROM api_connections WHERE workspace_id=$1 AND user_id=$2 AND status='active' AND revoked_at IS NULL
         AND scopes @> ARRAY['devices:read','devices:control']::text[] ORDER BY created_at DESC`,
      [workspaceId, user.id],
    );
    const grants = connection ? { rows: [] } : await pool.query(
      `SELECT g.id,g.connection_id AS "connectionId",g.device_id AS "deviceId",g.actions,g.permissions,g.expires_at AS "expiresAt",
         c.name AS "connectionName",d.name AS "deviceName"
       FROM device_grants g JOIN api_connections c ON c.id=g.connection_id JOIN devices d ON d.id=g.device_id
       WHERE g.workspace_id=$1 AND g.revoked_at IS NULL ORDER BY g.updated_at DESC`, [workspaceId],
    );
    response.json({ devices: devices.rows, operations: operations.rows.map(operationView), connections: connections.rows, grants: grants.rows });
  } catch (error) { next(error); }
});

deviceGatewayRouter.post("/workspaces/:workspaceId/device-enrollments", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId, true);
    const input = z.object({ providerName: z.string().trim().min(1).max(160) }).parse(request.body);
    const code = enrollmentCode();
    const result = await pool.query(
      `INSERT INTO device_enrollments (workspace_id,code_hash,provider_name,expires_at,created_by)
       VALUES ($1,$2,$3,now()+interval '10 minutes',$4)
       RETURNING id,provider_name AS "providerName",expires_at AS "expiresAt"`,
      [workspaceId, digest(normalizedEnrollmentCode(code)), input.providerName, user.id],
    );
    response.status(201).json({ enrollment: { ...result.rows[0], code } });
  } catch (error) { next(error); }
});

deviceGatewayRouter.post("/workspaces/:workspaceId/device-providers/:providerId/revoke", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const providerId = uuid.parse(request.params.providerId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId, true);
    const result = await withTransaction(async (client) => {
      const revoked = await client.query(
        `UPDATE device_providers SET status='revoked',revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND status='active' RETURNING id`,
        [providerId, workspaceId],
      );
      if (!revoked.rows[0]) return false;
      await client.query(`UPDATE devices SET remote_status='offline',updated_at=now() WHERE provider_id=$1`, [providerId]);
      return true;
    });
    if (!result) throw httpError(404, "设备连接不存在或已撤销");
    response.json({ success: true });
  } catch (error) { next(error); }
});

deviceGatewayRouter.post("/workspaces/:workspaceId/device-grants", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId, true);
    const input = z.object({ connectionId: uuid, deviceId: uuid, actions: z.array(actionName).min(1).max(100) }).parse(request.body);
    const manifest = await latestManifest(input.deviceId);
    if (!manifest) throw httpError(409, "设备尚未声明可调用动作");
    const knownActions = new Set(manifest.manifest.actions.map((item) => item.name));
    if (input.actions.some((item) => !knownActions.has(item))) throw httpError(400, "授权中包含设备未声明的动作");
    const owned = await pool.query(
      `SELECT 1 FROM api_connections c JOIN devices d ON d.workspace_id=c.workspace_id
       WHERE c.id=$1 AND c.workspace_id=$2 AND c.user_id=$3 AND c.status='active' AND d.id=$4`,
      [input.connectionId, workspaceId, user.id, input.deviceId],
    );
    if (!owned.rows[0]) throw httpError(404, "应用连接或设备不存在");
    const result = await pool.query(
      `INSERT INTO device_grants (connection_id,workspace_id,device_id,actions,permissions,granted_by)
       VALUES ($1,$2,$3,$4,ARRAY['read','control'],$5)
       ON CONFLICT (connection_id,device_id) DO UPDATE SET actions=EXCLUDED.actions,permissions=EXCLUDED.permissions,
         revoked_at=NULL,expires_at=NULL,granted_by=EXCLUDED.granted_by,updated_at=now()
       RETURNING id,connection_id AS "connectionId",device_id AS "deviceId",actions,permissions`,
      [input.connectionId, workspaceId, input.deviceId, [...new Set(input.actions)], user.id],
    );
    response.status(201).json({ grant: result.rows[0] });
  } catch (error) { next(error); }
});

deviceGatewayRouter.get("/workspaces/:workspaceId/devices/:deviceId/capabilities", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const deviceId = uuid.parse(request.params.deviceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId);
    await assertConnectionGrant(request, workspaceId, deviceId);
    const result = await pool.query(
      `SELECT manifest FROM device_capability_manifests WHERE workspace_id=$1 AND device_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [workspaceId, deviceId],
    );
    if (!result.rows[0]) throw httpError(404, "设备尚未声明可调用动作");
    response.json({ capabilities: result.rows[0].manifest });
  } catch (error) { next(error); }
});

deviceGatewayRouter.get("/workspaces/:workspaceId/devices/:deviceId", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const deviceId = uuid.parse(request.params.deviceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId);
    await assertConnectionGrant(request, workspaceId, deviceId);
    const result = await pool.query(
      `SELECT d.id,d.workspace_id AS "workspaceId",d.name,d.model,d.location,d.firmware_version AS "firmwareVersion",
         d.connection_mode AS "connectionMode",d.capability_version AS "capabilityVersion",d.last_seen_at AS "lastSeenAt",
         CASE WHEN d.connection_mode='remote' AND d.last_seen_at>now()-interval '45 seconds' AND p.status='active' THEN 'online' ELSE 'offline' END AS status
       FROM devices d LEFT JOIN device_providers p ON p.id=d.provider_id WHERE d.id=$1 AND d.workspace_id=$2`,
      [deviceId, workspaceId],
    );
    if (!result.rows[0]) throw httpError(404, "设备不存在");
    response.json({ device: result.rows[0] });
  } catch (error) { next(error); }
});

deviceGatewayRouter.post("/workspaces/:workspaceId/devices/:deviceId/operations", async (request, response, next) => {
  try {
    const apiRequest = request as unknown as AuthenticatedApiRequest;
    const user = apiRequest.currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const deviceId = uuid.parse(request.params.deviceId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId, true);
    const input = z.object({
      action: actionName,
      arguments: jsonObject.default({}),
      executionTimeoutMs: z.number().int().min(1000).max(300_000).optional(),
      expiresInMs: z.number().int().min(1000).max(300_000).default(30_000),
      queueIfOffline: z.boolean().default(true),
    }).parse(request.body);
    await assertConnectionGrant(request, workspaceId, deviceId, input.action, "control");
    const idempotencyKey = z.string().trim().min(8).max(200).parse(request.get("Idempotency-Key"));
    const device = await pool.query<{ providerId: string; online: boolean }>(
      `SELECT d.provider_id AS "providerId",(d.last_seen_at>now()-interval '45 seconds' AND p.status='active') AS online
       FROM devices d JOIN device_providers p ON p.id=d.provider_id
       WHERE d.id=$1 AND d.workspace_id=$2 AND d.connection_mode='remote'`, [deviceId, workspaceId],
    );
    if (!device.rows[0]) throw httpError(404, "远程设备不存在");
    if (!device.rows[0].online && !input.queueIfOffline) throw httpError(409, "设备当前离线，本次未排队", "device_offline");
    const manifestRecord = await latestManifest(deviceId);
    const capability = manifestRecord?.manifest.actions.find((item) => item.name === input.action && item.status !== "unavailable");
    if (!capability) throw httpError(400, "设备当前不能执行这个动作", "action_unavailable");
    const errors = validateJsonSchema(input.arguments, capability.inputSchema);
    if (errors.length) throw httpError(400, errors[0], "invalid_arguments");
    const timeout = input.executionTimeoutMs ?? capability.defaultTimeoutMs;
    if (timeout > capability.maximumTimeoutMs) throw httpError(400, "等待时间超过这个动作允许的上限");
    const callerKey = apiRequest.apiConnection ? `connection:${apiRequest.apiConnection.id}` : `user:${user.id}`;
    const isStop = input.action === "stop" || input.action.endsWith(".stop");
    const operation = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT o.id,o.device_id AS "deviceId",d.name AS "deviceName",o.action,o.status,o.arguments,o.result,o.error_code AS "errorCode",
           o.error_message AS "errorMessage",o.created_at AS "createdAt",o.expires_at AS "expiresAt",o.accepted_at AS "acceptedAt",
           o.started_at AS "startedAt",o.finished_at AS "finishedAt"
         FROM device_operations o JOIN devices d ON d.id=o.device_id
         WHERE o.workspace_id=$1 AND o.caller_key=$2 AND o.idempotency_key=$3`,
        [workspaceId, callerKey, idempotencyKey],
      );
      if (existing.rows[0]) return existing.rows[0];
      const active = await client.query<{ id: string; status: OperationStatus }>(
        `SELECT id,status FROM device_operations WHERE device_id=$1 AND status IN ('queued','leased','accepted','running','cancelling') FOR UPDATE`,
        [deviceId],
      );
      if (active.rows[0] && !isStop) throw httpError(409, "设备正在执行另一项操作，请等待完成后再试", "device_busy");
      if (active.rows[0] && isStop && ["leased", "accepted", "running"].includes(active.rows[0].status)) {
        await client.query(`UPDATE device_operations SET status='cancelling' WHERE id=$1`, [active.rows[0].id]);
      }
      const created = await client.query(
        `INSERT INTO device_operations
           (workspace_id,device_id,provider_id,action,arguments,status,caller_key,idempotency_key,created_by,connection_id,
            execution_timeout_ms,expires_at,priority)
         VALUES ($1,$2,$3,$4,$5::jsonb,'queued',$6,$7,$8,$9,$10,now()+($11::text||' milliseconds')::interval,$12)
         RETURNING id,device_id AS "deviceId",$13::text AS "deviceName",action,status,arguments,result,error_code AS "errorCode",
           error_message AS "errorMessage",created_at AS "createdAt",expires_at AS "expiresAt",accepted_at AS "acceptedAt",
           started_at AS "startedAt",finished_at AS "finishedAt"`,
        [workspaceId, deviceId, device.rows[0].providerId, input.action, JSON.stringify(input.arguments), callerKey, idempotencyKey,
          user.id, apiRequest.apiConnection?.id ?? null, timeout, input.expiresInMs, isStop ? 100 : 0, ""],
      );
      const deviceName = await client.query<{ name: string }>(`SELECT name FROM devices WHERE id=$1`, [deviceId]);
      created.rows[0].deviceName = deviceName.rows[0].name;
      await client.query(
        `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
         VALUES ($1,$2,$3,$4,0,'queued','{}'::jsonb)`,
        [created.rows[0].id, workspaceId, device.rows[0].providerId, `created:${created.rows[0].id}`],
      );
      if (!isStop) await client.query(`UPDATE devices SET current_operation_id=$1 WHERE id=$2`, [created.rows[0].id, deviceId]);
      return created.rows[0];
    });
    response.status(201).json({ operation: operationView(operation) });
  } catch (error) { next(error); }
});

async function loadAuthorizedOperation(request: Request, workspaceId: string, operationId: string) {
  await expireQueuedOperations(workspaceId);
  const connection = (request as AuthenticatedApiRequest).apiConnection;
  const result = await pool.query(
    `SELECT o.id,o.device_id AS "deviceId",d.name AS "deviceName",o.action,o.status,o.arguments,o.result,o.error_code AS "errorCode",
       o.error_message AS "errorMessage",o.created_at AS "createdAt",o.expires_at AS "expiresAt",o.accepted_at AS "acceptedAt",
       o.started_at AS "startedAt",o.finished_at AS "finishedAt"
     FROM device_operations o JOIN devices d ON d.id=o.device_id
     WHERE o.id=$1 AND o.workspace_id=$2 AND ($3::uuid IS NULL OR o.connection_id=$3)`,
    [operationId, workspaceId, connection?.id ?? null],
  );
  if (!result.rows[0]) throw httpError(404, "设备调用不存在");
  await assertConnectionGrant(request, workspaceId, result.rows[0].deviceId);
  return result.rows[0];
}

deviceGatewayRouter.get("/workspaces/:workspaceId/device-operations/:operationId", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const operationId = uuid.parse(request.params.operationId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId);
    response.json({ operation: operationView(await loadAuthorizedOperation(request, workspaceId, operationId)) });
  } catch (error) { next(error); }
});

deviceGatewayRouter.get("/workspaces/:workspaceId/device-operations/:operationId/events", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const operationId = uuid.parse(request.params.operationId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId);
    await loadAuthorizedOperation(request, workspaceId, operationId);
    const events = await pool.query(
      `SELECT event_id AS "eventId",sequence,status,payload,created_at AS "createdAt"
       FROM device_operation_events WHERE operation_id=$1 AND workspace_id=$2 ORDER BY sequence`,
      [operationId, workspaceId],
    );
    response.json({ events: events.rows });
  } catch (error) { next(error); }
});

deviceGatewayRouter.post("/workspaces/:workspaceId/device-operations/:operationId/cancel", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const workspaceId = uuid.parse(request.params.workspaceId);
    const operationId = uuid.parse(request.params.operationId);
    requireConnectionWorkspace(request, workspaceId);
    await requireWorkspace(user.id, workspaceId, true);
    const loaded = await loadAuthorizedOperation(request, workspaceId, operationId);
    await assertConnectionGrant(request, workspaceId, loaded.deviceId, loaded.action, "control");
    const result = await withTransaction(async (client) => {
      const locked = await client.query<{ status: OperationStatus; deviceId: string; providerId: string }>(
        `SELECT status,device_id AS "deviceId",provider_id AS "providerId" FROM device_operations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
        [operationId, workspaceId],
      );
      const operation = locked.rows[0];
      if (!operation) throw httpError(404, "设备调用不存在");
      if (terminalStatuses.has(operation.status)) return operation.status;
      const nextStatus = operation.status === "queued" ? "cancelled" : "cancelling";
      await client.query(
        `UPDATE device_operations SET status=$1,finished_at=CASE WHEN $1='cancelled' THEN now() ELSE finished_at END WHERE id=$2`,
        [nextStatus, operationId],
      );
      await client.query(
        `INSERT INTO device_operation_events (operation_id,workspace_id,provider_id,event_id,sequence,status,payload)
         VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(sequence)+1,0) FROM device_operation_events WHERE operation_id=$1),$5,'{}'::jsonb)`,
        [operationId, workspaceId, operation.providerId, `cancel:${randomUUID()}`, nextStatus],
      );
      if (nextStatus === "cancelled") await client.query(`UPDATE devices SET current_operation_id=NULL WHERE id=$1 AND current_operation_id=$2`, [operation.deviceId, operationId]);
      return nextStatus;
    });
    response.json({ operationId, status: result });
  } catch (error) { next(error); }
});

export function deviceGatewayErrorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "请求内容不完整或格式不正确", details: error.issues.map((issue) => issue.path.join(".")) });
  const known = error as Error & { status?: number; code?: string };
  if (known.status) return response.status(known.status).json({ error: known.message, code: known.code });
  console.error("[STMWEB] device gateway request failed", error);
  return response.status(500).json({ error: "设备操作没有完成，请稍后再试" });
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { pool } from "./database.js";
import { env } from "./env.js";
import { getAuthenticatedUser, type InternalUser } from "./internal-auth.js";
import { hasStmwebProAccess } from "./passport.js";

export const API_SCOPES = [
  "devices:read", "devices:control", "debug:read", "debug:execute",
  "runners:read", "runners:manage", "builds:read", "builds:create", "builds:cancel", "artifacts:read",
] as const;
export type ApiScope = typeof API_SCOPES[number];

export interface ApiConnectionIdentity {
  id: string;
  workspaceId: string;
  scopes: ApiScope[];
}

export interface AuthenticatedApiRequest extends Request {
  currentUser: InternalUser;
  apiConnection?: ApiConnectionIdentity;
}

function digestCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function verifyOrigin(request: Request): boolean {
  return request.get("origin") === new URL(env.BETTER_AUTH_URL).origin;
}

function bearerCredential(request: Request): string | null {
  const authorization = request.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const credential = authorization.slice(7).trim();
  return credential.startsWith("stmweb_api_") ? credential : null;
}

export async function resolveApiConnectionCredential(credential: string): Promise<{
  user: InternalUser;
  connection: ApiConnectionIdentity;
} | null> {
  if (!credential.startsWith("stmweb_api_")) return null;
  const digest = digestCredential(credential);
  const result = await pool.query<InternalUser & { connectionId: string; workspaceId: string; scopes: ApiScope[]; credentialHash: string }>(
    `UPDATE api_connections c SET last_used_at=now()
     FROM internal_users u
     WHERE c.credential_hash=$1 AND c.user_id=u.id AND c.status='active'
       AND c.revoked_at IS NULL AND u.enabled=true
     RETURNING u.id, u.username, u.display_name AS name, u.email,
       u.passport_user_id AS "passportUserId", c.id AS "connectionId",
       c.workspace_id AS "workspaceId", c.scopes, c.credential_hash AS "credentialHash"`,
    [digest],
  );
  const identity = result.rows[0];
  if (!identity || !timingSafeEqual(Buffer.from(identity.credentialHash), Buffer.from(digest))) return null;
  return {
    user: identity,
    connection: { id: identity.connectionId, workspaceId: identity.workspaceId, scopes: identity.scopes },
  };
}

export function requiredApiScope(method: string, path: string): ApiScope | null {
  if (/\/devices$/.test(path)) return method === "GET" ? "devices:read" : "devices:control";
  if (/\/hardware-projects(?:\/templates)?$/.test(path)) return method === "GET" ? "builds:read" : "builds:create";
  if (/\/firmware-packages\/[^/]+\/stable$/.test(path)) return "builds:create";
  if (/\/firmware(?:\/[^/]+\/content)?$/.test(path)) return method === "GET" ? "artifacts:read" : "builds:create";
  if (/\/sessions(?:\/|$)/.test(path)) return method === "GET" ? "debug:read" : "debug:execute";
  if (/\/workbench\//.test(path)) return method === "GET" ? "debug:read" : "debug:execute";
  if (/\/runners\/pairing$/.test(path)) return "runners:manage";
  if (/\/runners$/.test(path)) return "runners:read";
  if (/\/builds\/[^/]+\/cancel$/.test(path)) return "builds:cancel";
  if (/\/builds\/[^/]+\/artifacts\//.test(path)) return "artifacts:read";
  if (/\/builds\/[^/]+(?:\/events)?$/.test(path) && method === "GET" || /\/builds$/.test(path) && method === "GET") return "builds:read";
  if (/\/builds$/.test(path) && method === "POST") return "builds:create";
  return null;
}

export async function requireUserOrApiConnection(request: Request, response: Response, next: NextFunction) {
  try {
    const credential = bearerCredential(request);
    if (!credential) {
      const user = await getAuthenticatedUser(request);
      if (!user) return response.status(401).json({ error: "请先登录或提供 API 凭证" });
      (request as AuthenticatedApiRequest).currentUser = user;
      return next();
    }
    const identity = await resolveApiConnectionCredential(credential);
    if (!identity) {
      return response.status(401).json({ error: "API 凭证无效或已撤销" });
    }
    if (!await hasStmwebProAccess({ id: identity.user.passportUserId, email: identity.user.email })) {
      return response.status(403).json({ error: "API 连接需要有效的 Pro 计划", code: "pro_required" });
    }
    const apiRequest = request as AuthenticatedApiRequest;
    apiRequest.currentUser = identity.user;
    apiRequest.apiConnection = identity.connection;
    response.on("finish", () => {
      const action = `${request.method} ${request.baseUrl}${request.path}`.slice(0, 200);
      void pool.query(
        `INSERT INTO api_audit_events (connection_id, workspace_id, action, outcome)
         VALUES ($1,$2,$3,$4)`,
        [identity.connection.id, identity.connection.workspaceId, action, response.statusCode < 400 ? "succeeded" : "failed"],
      ).catch(() => undefined);
    });
    return next();
  } catch (error) { return next(error); }
}

export function requireConnectionScope(request: Request, response: Response, next: NextFunction) {
  const connection = (request as AuthenticatedApiRequest).apiConnection;
  if (!connection) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !verifyOrigin(request)) {
      return response.status(403).json({ error: "请求来源未获授权" });
    }
    return next();
  }
  if (request.method === "GET" && (request.path === "/me" || request.path === "/bootstrap")) return next();
  const required = requiredApiScope(request.method, request.path);
  if (!required) return response.status(404).json({ error: "此操作尚未开放给 API 连接" });
  if (!connection.scopes.includes(required)) return response.status(403).json({ error: "API 连接未获准执行此操作" });
  return next();
}

export function requireConnectionWorkspace(request: Request, workspaceId: string): void {
  const connection = (request as AuthenticatedApiRequest).apiConnection;
  if (connection && connection.workspaceId !== workspaceId) {
    const error = new Error("API 连接无权访问此工作区") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

const connectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(500),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length).transform((items) => [...new Set(items)]),
});

function connectionView(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, purpose: row.purpose, scopes: row.scopes,
    credentialHint: row.credentialHint, status: row.status, createdAt: row.createdAt,
    rotatedAt: row.rotatedAt, lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt,
  };
}

function issueCredential() {
  const credential = `stmweb_api_${randomBytes(32).toString("base64url")}`;
  return { credential, hash: digestCredential(credential), hint: credential.slice(-6) };
}

export const apiConnectionsRouter = express.Router();
apiConnectionsRouter.use(express.json({ limit: "32kb" }));
apiConnectionsRouter.use(async (request, response, next) => {
  try {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "请先登录" });
    if (!await hasStmwebProAccess({ id: user.passportUserId, email: user.email })) {
      return response.status(403).json({ error: "API 连接需要 Pro 计划", code: "pro_required" });
    }
    (request as AuthenticatedApiRequest).currentUser = user;
    return next();
  } catch (error) { return next(error); }
});

apiConnectionsRouter.get("/", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const result = await pool.query(
      `SELECT c.id,c.name,c.purpose,c.scopes,c.credential_hint AS "credentialHint",c.status,
         c.created_at AS "createdAt",c.rotated_at AS "rotatedAt",c.last_used_at AS "lastUsedAt",c.revoked_at AS "revokedAt"
       FROM api_connections c JOIN workspace_members wm ON wm.workspace_id=c.workspace_id
       WHERE c.user_id=$1 AND wm.user_id=$1 ORDER BY c.created_at DESC`, [user.id],
    );
    const activity = await pool.query(
      `SELECT a.id,a.connection_id AS "connectionId",a.action,a.outcome,a.occurred_at AS "occurredAt"
       FROM api_audit_events a JOIN api_connections c ON c.id=a.connection_id
       WHERE c.user_id=$1 ORDER BY a.occurred_at DESC LIMIT 50`, [user.id],
    );
    response.json({ connections: result.rows.map(connectionView), recentActivity: activity.rows });
  } catch (error) { next(error); }
});

apiConnectionsRouter.post("/", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const input = connectionInput.parse(request.body);
    const workspace = await pool.query<{ id: string }>(
      `SELECT workspace_id AS id FROM workspace_members WHERE user_id=$1 AND role IN ('owner','editor') ORDER BY created_at LIMIT 1`, [user.id],
    );
    if (!workspace.rows[0]) return response.status(403).json({ error: "当前账户没有可授权的工作区" });
    const issued = issueCredential();
    const result = await pool.query(
      `INSERT INTO api_connections (user_id,workspace_id,name,purpose,scopes,credential_hash,credential_hint)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,name,purpose,scopes,credential_hint AS "credentialHint",status,created_at AS "createdAt",
         rotated_at AS "rotatedAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt"`,
      [user.id, workspace.rows[0].id, input.name, input.purpose, input.scopes, issued.hash, issued.hint],
    );
    response.status(201).json({ connection: connectionView(result.rows[0]), credential: issued.credential });
  } catch (error) { next(error); }
});

apiConnectionsRouter.post("/:connectionId/rotate", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const id = z.string().uuid().parse(request.params.connectionId);
    const issued = issueCredential();
    const result = await pool.query(
      `UPDATE api_connections SET credential_hash=$1,credential_hint=$2,rotated_at=now()
       WHERE id=$3 AND user_id=$4 AND status='active' AND revoked_at IS NULL RETURNING id`,
      [issued.hash, issued.hint, id, user.id],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "API 连接不存在或已撤销" });
    response.json({ credential: issued.credential });
  } catch (error) { next(error); }
});

apiConnectionsRouter.post("/:connectionId/revoke", async (request, response, next) => {
  try {
    const user = (request as unknown as AuthenticatedApiRequest).currentUser;
    const id = z.string().uuid().parse(request.params.connectionId);
    const result = await pool.query(
      `UPDATE api_connections SET status='revoked',revoked_at=now()
       WHERE id=$1 AND user_id=$2 AND status='active' RETURNING id`, [id, user.id],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "API 连接不存在或已撤销" });
    response.json({ success: true });
  } catch (error) { next(error); }
});

apiConnectionsRouter.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "请完整填写连接名称、用途和至少一项权限" });
  return response.status(500).json({ error: "API 连接服务暂时不可用" });
});

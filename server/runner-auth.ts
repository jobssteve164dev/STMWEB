import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "./database.js";

export interface RunnerIdentity {
  id: string;
  workspaceId: string;
  name: string;
}

export interface RunnerRequest extends Request {
  runnerIdentity: RunnerIdentity;
}

export function digestRunnerSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function requireRunner(request: Request, response: Response, next: NextFunction) {
  const authorization = request.get("authorization") ?? "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  if (!match) {
    response.status(401).json({ error: "编译算力凭证缺失" });
    return;
  }
  const tokenHash = digestRunnerSecret(match[1]);
  const result = await pool.query<{ id: string; workspaceId: string; name: string; tokenHash: string }>(
    `SELECT id, workspace_id AS "workspaceId", name, token_hash AS "tokenHash"
     FROM build_runners WHERE token_hash = $1 AND revoked = false`,
    [tokenHash],
  );
  const runner = result.rows[0];
  if (!runner || !timingSafeEqual(Buffer.from(runner.tokenHash), Buffer.from(tokenHash))) {
    response.status(401).json({ error: "编译算力凭证无效或已撤销" });
    return;
  }
  (request as RunnerRequest).runnerIdentity = { id: runner.id, workspaceId: runner.workspaceId, name: runner.name };
  next();
}

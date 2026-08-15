import { createHash, randomBytes, scryptSync } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { pool } from "./database.js";
import { env } from "./env.js";
import { linkPassportIdentity, loginWithPassport, PassportError } from "./passport.js";

const COOKIE_NAME = "stmweb_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const attempts = new Map<string, { count: number; resetAt: number }>();

export interface InternalUser {
  id: string;
  username: string;
  name: string;
  email: string;
  passportUserId: string;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(request: Request): string | null {
  const item = (request.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return item ? decodeURIComponent(item.slice(COOKIE_NAME.length + 1)) : null;
}

function verifyOrigin(request: Request): boolean {
  return request.get("origin") === new URL(env.BETTER_AUTH_URL).origin;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_SECONDS * 1000,
  };
}

async function upsertPassportUser(user: { id: string; email: string; name: string | null }): Promise<InternalUser> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM internal_users WHERE passport_user_id=$1 OR username=$2 ORDER BY passport_user_id=$1 DESC LIMIT 1`,
    [user.id, user.email],
  );
  if (existing.rows[0]) {
    const updated = await pool.query<InternalUser>(
      `UPDATE internal_users SET username=$2, passport_user_id=$3, email=$2, display_name=$4,
         enabled=true, updated_at=now() WHERE id=$1
       RETURNING id, username, display_name AS name, email, passport_user_id AS "passportUserId"`,
      [existing.rows[0].id, user.email, user.id, user.name ?? user.email.split("@")[0]],
    );
    return updated.rows[0];
  }
  const created = await pool.query<InternalUser>(
    `INSERT INTO internal_users (username, password_hash, display_name, passport_user_id, email)
     VALUES ($1, NULL, $2, $3, $1)
     RETURNING id, username, display_name AS name, email, passport_user_id AS "passportUserId"`,
    [user.email, user.name ?? user.email.split("@")[0], user.id],
  );
  return created.rows[0];
}

export async function ensureBootstrapUser(): Promise<void> {
  if (!env.STMWEB_ADMIN_USERNAME || !env.STMWEB_ADMIN_PASSWORD) return;
  const passwordHash = hashPassword(env.STMWEB_ADMIN_PASSWORD);
  await pool.query(
    `INSERT INTO internal_users (username, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, enabled = true, updated_at = now()`,
    [env.STMWEB_ADMIN_USERNAME.toLowerCase(), passwordHash, env.STMWEB_ADMIN_USERNAME],
  );
}

export async function getAuthenticatedUser(request: Request): Promise<InternalUser | null> {
  const token = readCookie(request);
  if (!token) return null;
  const result = await pool.query<InternalUser>(
    `UPDATE internal_sessions s SET last_seen_at = now()
     FROM internal_users u
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.enabled = true
     RETURNING u.id, u.username, u.display_name AS name, u.email,
       u.passport_user_id AS "passportUserId"`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export const internalAuthRouter = express.Router();
internalAuthRouter.use(express.json({ limit: "16kb" }));

internalAuthRouter.post("/login", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const key = request.ip || "unknown";
    const now = Date.now();
    const rate = attempts.get(key);
    if (rate && rate.resetAt > now && rate.count >= 10) {
      return response.status(429).json({ error: "尝试次数过多，请稍后再试" });
    }
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!email || !password) return response.status(400).json({ error: "请填写邮箱和密码" });
    let passport;
    try {
      passport = await loginWithPassport(email, password);
    } catch (error) {
      attempts.set(key, { count: rate?.resetAt && rate.resetAt > now ? rate.count + 1 : 1, resetAt: now + 60_000 });
      if (error instanceof PassportError && ["auth_invalid_credentials", "auth_user_not_found"].includes(error.code)) {
        return response.status(401).json({ error: "邮箱或密码不正确" });
      }
      if (error instanceof PassportError && error.status === 429) return response.status(429).json({ error: "尝试次数过多，请稍后再试" });
      return response.status(503).json({ error: "账号服务暂时不可用，请稍后再试" });
    }
    if (passport.needsEmailVerification) return response.status(409).json({ error: "请先完成邮箱验证，再回来登录" });
    const user = passport.user;
    const account = await upsertPassportUser(user);
    await linkPassportIdentity(user, account.id);
    attempts.delete(key);
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO internal_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '7 days')`,
      [account.id, tokenHash(token)],
    );
    response.cookie(COOKIE_NAME, token, cookieOptions());
    return response.json({ user: account });
  } catch (error) {
    console.error("[STMWEB] Passport login completion failed", error instanceof PassportError ? {
      code: error.code,
      status: error.status,
      requestId: typeof error.details?.requestId === "string" ? error.details.requestId : null,
      stage: typeof error.details?.stage === "string" ? error.details.stage : null,
    } : error);
    if (error instanceof PassportError) return response.status(503).json({ error: "账号登录没有完成，请稍后再试" });
    return next(error);
  }
});

internalAuthRouter.post("/logout", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const token = readCookie(request);
    if (token) await pool.query(`DELETE FROM internal_sessions WHERE token_hash = $1`, [tokenHash(token)]);
    response.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    return response.json({ success: true });
  } catch (error) { return next(error); }
});

internalAuthRouter.get("/session", async (request, response, next) => {
  try {
    const user = await getAuthenticatedUser(request);
    return response.json({ user });
  } catch (error) { return next(error); }
});

export async function requireInternalSession(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "请先登录" });
    (request as Request & { currentUser: InternalUser }).currentUser = user;
    return next();
  } catch (error) { return next(error); }
}

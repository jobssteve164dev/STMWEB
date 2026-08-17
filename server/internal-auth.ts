import { createHash, randomBytes, scryptSync } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { pool } from "./database.js";
import { env } from "./env.js";
import {
  linkPassportIdentity,
  loginWithPassport,
  PassportError,
  registerWithPassport,
  requestPassportPasswordReset,
  resendPassportVerification,
  resetPassportPassword,
  verifyPassportEmail,
  type PassportUser,
} from "./passport.js";

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

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

async function completeAuthentication(user: PassportUser, response: Response) {
  const account = await upsertPassportUser(user);
  await linkPassportIdentity(user, account.id);
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO internal_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '7 days')`,
    [account.id, tokenHash(token)],
  );
  response.cookie(COOKIE_NAME, token, cookieOptions());
  return response.json({ user: account });
}

function passportFailure(response: Response, error: PassportError, fallback: string) {
  if (["auth_invalid_credentials", "auth_user_not_found"].includes(error.code)) {
    return response.status(401).json({ error: "邮箱或密码不正确" });
  }
  if (error.code === "auth_email_exists" || error.status === 409) {
    return response.status(409).json({ error: "这个邮箱已经注册，请直接登录" });
  }
  if (error.code === "auth_rate_limited" || error.status === 429) {
    return response.status(429).json({ error: "尝试次数过多，请稍后再试" });
  }
  if (error.code === "auth_invalid_token" || error.status === 400) {
    return response.status(400).json({ error: "链接无效或已经过期，请重新获取" });
  }
  return response.status(503).json({ error: fallback });
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
    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!email || !password) return response.status(400).json({ error: "请填写邮箱和密码" });
    let passport;
    try {
      passport = await loginWithPassport(email, password);
    } catch (error) {
      attempts.set(key, { count: rate?.resetAt && rate.resetAt > now ? rate.count + 1 : 1, resetAt: now + 60_000 });
      if (error instanceof PassportError) return passportFailure(response, error, "账号服务暂时不可用，请稍后再试");
      return response.status(503).json({ error: "账号服务暂时不可用，请稍后再试" });
    }
    if (passport.needsEmailVerification) return response.status(409).json({ error: "请先完成邮箱验证，再回来登录", code: "email_verification_required", email });
    attempts.delete(key);
    return await completeAuthentication(passport.user, response);
  } catch (error) {
    console.error("[STMWEB] Passport login completion failed", error instanceof PassportError ? {
      code: error.code,
      status: error.status,
      requestId: typeof error.details?.requestId === "string" ? error.details.requestId : null,
      stage: typeof error.details?.stage === "string" ? error.details.stage : null,
      reason: typeof error.details?.reason === "string" ? error.details.reason : null,
      operation: typeof error.details?.operation === "string" ? error.details.operation : null,
      elapsedMs: typeof error.details?.elapsedMs === "number" ? error.details.elapsedMs : null,
    } : error);
    if (error instanceof PassportError) return response.status(503).json({ error: "账号登录没有完成，请稍后再试" });
    return next(error);
  }
});

internalAuthRouter.post("/register", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const name = typeof request.body?.name === "string" ? request.body.name.trim().slice(0, 80) : "";
    if (!email || !password) return response.status(400).json({ error: "请填写邮箱和密码" });
    if (password.length < 8) return response.status(400).json({ error: "密码至少需要 8 位" });
    const result = await registerWithPassport(email, password, name || null);
    return response.json({ success: true, needsEmailVerification: result.needsEmailVerification, email });
  } catch (error) {
    if (error instanceof PassportError) return passportFailure(response, error, "注册没有完成，请稍后再试");
    return next(error);
  }
});

internalAuthRouter.post("/resend-verification", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const email = normalizeEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "请填写邮箱" });
    await resendPassportVerification(email);
    return response.json({ success: true });
  } catch (error) {
    if (error instanceof PassportError) return passportFailure(response, error, "验证邮件没有发送成功，请稍后再试");
    return next(error);
  }
});

internalAuthRouter.post("/forgot-password", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const email = normalizeEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "请填写邮箱" });
    await requestPassportPasswordReset(email);
    return response.json({ success: true });
  } catch (error) {
    if (error instanceof PassportError) return passportFailure(response, error, "重置邮件没有发送成功，请稍后再试");
    return next(error);
  }
});

internalAuthRouter.post("/verify-email", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
    if (!token) return response.status(400).json({ error: "验证链接不完整，请重新获取验证邮件" });
    return await completeAuthentication(await verifyPassportEmail(token), response);
  } catch (error) {
    if (error instanceof PassportError) return passportFailure(response, error, "邮箱验证没有完成，请稍后再试");
    return next(error);
  }
});

internalAuthRouter.post("/reset-password", async (request, response, next) => {
  try {
    if (!verifyOrigin(request)) return response.status(403).json({ error: "请求来源未获授权" });
    const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!token || password.length < 8) return response.status(400).json({ error: "请使用有效链接，并设置至少 8 位的新密码" });
    return await completeAuthentication(await resetPassportPassword(token, password), response);
  } catch (error) {
    if (error instanceof PassportError) return passportFailure(response, error, "密码重置没有完成，请稍后再试");
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

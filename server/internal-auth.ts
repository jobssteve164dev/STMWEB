import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { pool } from "./database.js";
import { env } from "./env.js";

const COOKIE_NAME = "stmweb_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const attempts = new Map<string, { count: number; resetAt: number }>();

export interface InternalUser {
  id: string;
  username: string;
  name: string;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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

export async function ensureBootstrapUser(): Promise<void> {
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
     RETURNING u.id, u.username, u.display_name AS name`,
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
    const username = typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const result = await pool.query<{ id: string; username: string; name: string; password_hash: string }>(
      `SELECT id, username, display_name AS name, password_hash FROM internal_users
       WHERE username = $1 AND enabled = true`,
      [username],
    );
    const account = result.rows[0];
    if (!account || !verifyPassword(password, account.password_hash)) {
      attempts.set(key, { count: rate?.resetAt && rate.resetAt > now ? rate.count + 1 : 1, resetAt: now + 60_000 });
      return response.status(401).json({ error: "账号或密码不正确" });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO internal_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '7 days')`,
      [account.id, tokenHash(token)],
    );
    response.cookie(COOKIE_NAME, token, cookieOptions());
    return response.json({ user: { id: account.id, username: account.username, name: account.name } });
  } catch (error) { return next(error); }
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

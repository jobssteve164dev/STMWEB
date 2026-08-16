import { env } from "./env.js";

export class PassportError extends Error {
  constructor(
    message: string,
    readonly status = 503,
    readonly code = "passport_unavailable",
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

function configuredSecret(): string {
  if (!env.SZLK_PASSPORT_SECRET) {
    throw new PassportError("账号服务尚未配置", 503, "passport_secret_missing");
  }
  return env.SZLK_PASSPORT_SECRET;
}

async function passportRequest(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const url = new URL(`/api/v1/${path}`, env.SZLK_PASSPORT_URL);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-SZLK-Product": env.PASSPORT_PRODUCT,
      "X-SZLK-Secret": configuredSecret(),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((error: unknown) => {
    const cause = error instanceof Error && error.cause && typeof error.cause === "object"
      ? error.cause as { code?: unknown }
      : null;
    throw new PassportError("账号服务暂时不可用", 503, "passport_unavailable", {
      operation: path,
      elapsedMs: Date.now() - startedAt,
      reason: typeof cause?.code === "string" ? cause.code : error instanceof Error ? error.name : "unknown",
    });
  });
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const remoteError = value?.error && typeof value.error === "object" ? value.error as Record<string, unknown> : null;
    throw new PassportError(
      typeof remoteError?.message === "string" ? remoteError.message : "账号服务暂时不可用",
      response.status,
      typeof remoteError?.code === "string" ? remoteError.code : "passport_request_failed",
      remoteError?.details && typeof remoteError.details === "object" && !Array.isArray(remoteError.details)
        ? remoteError.details as Record<string, unknown>
        : null,
    );
  }
  if (!value || value.ok !== true || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    throw new PassportError("账号服务返回了无效响应");
  }
  return value.data as Record<string, unknown>;
}

export interface PassportUser { id: string; email: string; name: string | null }
export const STMWEB_PRO_FEATURE = "paid_subscription";

const accessCache = new Map<string, { allowed: boolean; checkedAt: number }>();

function readUser(result: Record<string, unknown>): PassportUser {
  const raw = result.user;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PassportError("账号服务返回了无效用户");
  const user = raw as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.email !== "string") throw new PassportError("账号服务返回了不完整用户");
  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : null,
  };
}

export async function loginWithPassport(email: string, password: string) {
  const result = await passportRequest("auth/login", { method: "POST", body: { email, password } });
  return { user: readUser(result), needsEmailVerification: result.needsEmailVerification === true };
}

export async function linkPassportIdentity(user: PassportUser, productUserId: string) {
  await passportRequest("passport/link", { method: "POST", body: {
    email: user.email,
    product: env.PASSPORT_PRODUCT,
    productUid: productUserId,
    metadata: { integration: "stmweb" },
  } });
}

export function getBillingCatalog() {
  return passportRequest("billing/catalog", { query: { product: env.PASSPORT_PRODUCT } });
}

export async function hasStmwebProAccess(user: { id: string; email: string }): Promise<boolean> {
  const cacheKey = `${user.id}:${STMWEB_PRO_FEATURE}`;
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached.allowed;
  const decision = await passportRequest("entitlements/access-check", {
    method: "POST",
    body: {
      userId: user.id,
      email: user.email,
      product: env.PASSPORT_PRODUCT,
      featureKey: STMWEB_PRO_FEATURE,
    },
  });
  const allowed = decision.allowed === true && decision.featureKey === STMWEB_PRO_FEATURE;
  accessCache.set(cacheKey, { allowed, checkedAt: Date.now() });
  return allowed;
}

export async function createCheckoutLink(input: { planId: string; user: PassportUser }) {
  const catalog = await getBillingCatalog();
  const plans = Array.isArray(catalog.plans) ? catalog.plans : [];
  const selected = plans.find((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).planId === input.planId);
  if (!selected) throw new PassportError("所选方案当前不可用", 400, "billing_plan_unavailable");
  const baseUrl = new URL(env.BETTER_AUTH_URL).origin;
  return await passportRequest("billing/checkout-link", { method: "POST", body: {
    product: env.PASSPORT_PRODUCT,
    planId: input.planId,
    userId: input.user.id,
    email: input.user.email,
    successUrl: `${baseUrl}/workbench?checkout=success`,
    cancelUrl: `${baseUrl}/plans?checkout=cancel`,
  } });
}

export function createBillingPortalLink(user: PassportUser) {
  return passportRequest("billing/portal-link", { query: {
    product: env.PASSPORT_PRODUCT,
    userId: user.id,
    email: user.email,
    returnUrl: new URL(env.BETTER_AUTH_URL).origin,
  } });
}

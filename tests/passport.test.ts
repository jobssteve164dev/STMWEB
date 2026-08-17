import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET = "12345678901234567890123456789012";
process.env.BETTER_AUTH_URL = "https://stmweb.example";
process.env.SZLK_PASSPORT_URL = "https://passport.example";
process.env.SZLK_PASSPORT_SECRET = "product-secret";
process.env.PASSPORT_PRODUCT = "stmweb";

test("uses SZLKPassport v1 envelope and product authentication for login", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true, data: { user: { id: "passport-1", email: "USER@example.com", name: "用户" } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { loginWithPassport } = await import("../server/passport.js");
  const result = await loginWithPassport("user@example.com", "password");
  assert.equal(result.user.email, "user@example.com");
  assert.equal(calls[0].url, "https://passport.example/api/v1/auth/login");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-SZLK-Product"], "stmweb");
  assert.equal(headers["X-SZLK-Secret"], "product-secret");
});

test("uses the Passport headless registration and password recovery contract", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const data = path.endsWith("/auth/register")
      ? { needsEmailVerification: true }
      : path.endsWith("/auth/verify-email") || path.endsWith("/auth/reset-password")
        ? { user: { id: "passport-2", email: "USER@example.com", name: "用户" } }
        : {};
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const {
    registerWithPassport,
    requestPassportPasswordReset,
    resendPassportVerification,
    resetPassportPassword,
    verifyPassportEmail,
  } = await import("../server/passport.js");

  assert.deepEqual(await registerWithPassport("user@example.com", "password", "用户"), { needsEmailVerification: true });
  await resendPassportVerification("user@example.com");
  await requestPassportPasswordReset("user@example.com");
  assert.equal((await verifyPassportEmail("verify-token")).email, "user@example.com");
  assert.equal((await resetPassportPassword("reset-token", "new-password")).id, "passport-2");

  assert.deepEqual(calls, [
    { path: "/api/v1/auth/register", body: { email: "user@example.com", password: "password", name: "用户", appBaseUrl: "https://stmweb.example" } },
    { path: "/api/v1/auth/resend-verification", body: { email: "user@example.com", appBaseUrl: "https://stmweb.example" } },
    { path: "/api/v1/auth/forgot-password", body: { email: "user@example.com", appBaseUrl: "https://stmweb.example" } },
    { path: "/api/v1/auth/verify-email", body: { token: "verify-token" } },
    { path: "/api/v1/auth/reset-password", body: { token: "reset-token", password: "new-password" } },
  ]);
});

test("creates checkout only for a plan returned by the Passport catalog", async () => {
  const paths: string[] = [];
  let checkoutBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith("/billing/checkout-link")) checkoutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const data = url.pathname.endsWith("/billing/catalog")
      ? { plans: [{ planId: "stmweb-pro" }] }
      : { url: "https://checkout.example/session" };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { createCheckoutLink } = await import("../server/passport.js");
  const result = await createCheckoutLink({ planId: "stmweb-pro", user: { id: "passport-1", email: "user@example.com", name: null } });
  assert.deepEqual(paths, ["/api/v1/billing/catalog", "/api/v1/billing/checkout-link"]);
  assert.equal(result.url, "https://checkout.example/session");
  assert.equal(checkoutBody?.successUrl, "https://stmweb.example/workbench?checkout=success");
  assert.equal(checkoutBody?.cancelUrl, "https://stmweb.example/plans?checkout=cancel");
  await assert.rejects(
    createCheckoutLink({ planId: "invented", user: { id: "passport-1", email: "user@example.com", name: null } }),
    /所选方案当前不可用/,
  );
});

test("links the final persisted local account id to the Passport identity", async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { linkPassportIdentity } = await import("../server/passport.js");
  await linkPassportIdentity({ id: "passport-user-1", email: "user@example.com", name: "用户" }, "local-user-1");
  assert.deepEqual(requestBody, {
    email: "user@example.com",
    product: "stmweb",
    productUid: "local-user-1",
    metadata: { integration: "stmweb" },
  });
});

test("uses the shared Passport entitlement as the Pro access source of truth", async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/api/v1/entitlements/access-check");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ ok: true, data: { allowed: true, featureKey: "paid_subscription" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { hasStmwebProAccess } = await import("../server/passport.js");
  assert.equal(await hasStmwebProAccess({ id: "passport-entitled-1", email: "pro@example.com" }), true);
  assert.deepEqual(requestBody, {
    userId: "passport-entitled-1",
    email: "pro@example.com",
    product: "stmweb",
    featureKey: "paid_subscription",
  });
});

test("preserves Passport request id and failure stage for server-side diagnosis", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error: {
      code: "passport_link_failed",
      message: "Failed to link product identity",
      details: { requestId: "request-1", stage: "sync_entitlements" },
    },
  }), { status: 500, headers: { "Content-Type": "application/json" } });
  const { linkPassportIdentity, PassportError } = await import("../server/passport.js");
  await assert.rejects(
    linkPassportIdentity({ id: "passport-user-1", email: "user@example.com", name: null }, "local-user-1"),
    (error: unknown) => error instanceof PassportError
      && error.code === "passport_link_failed"
      && error.details?.requestId === "request-1"
      && error.details?.stage === "sync_entitlements",
  );
});

test("identifies the Passport operation when transport fails", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  const { loginWithPassport, PassportError } = await import("../server/passport.js");
  await assert.rejects(
    loginWithPassport("user@example.com", "password"),
    (error: unknown) => error instanceof PassportError
      && error.details?.operation === "auth/login"
      && typeof error.details.elapsedMs === "number",
  );
});

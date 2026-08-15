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

test("creates checkout only for a plan returned by the Passport catalog", async () => {
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    const data = url.pathname.endsWith("/billing/catalog")
      ? { plans: [{ planId: "stmweb-pro" }] }
      : { url: "https://checkout.example/session" };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { createCheckoutLink } = await import("../server/passport.js");
  const result = await createCheckoutLink({ planId: "stmweb-pro", user: { id: "passport-1", email: "user@example.com", name: null } });
  assert.deepEqual(paths, ["/api/v1/billing/catalog", "/api/v1/billing/checkout-link"]);
  assert.equal(result.url, "https://checkout.example/session");
  await assert.rejects(
    createCheckoutLink({ planId: "invented", user: { id: "passport-1", email: "user@example.com", name: null } }),
    /所选方案当前不可用/,
  );
});

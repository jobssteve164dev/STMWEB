import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET = "12345678901234567890123456789012";
process.env.BETTER_AUTH_URL = "https://stmweb.example";
process.env.SZLK_PASSPORT_URL = "https://passport.example";
process.env.SZLK_PASSPORT_SECRET = "product-secret";
process.env.PASSPORT_PRODUCT = "stmweb";

test("exposes registration and password recovery through the internal auth router", async () => {
  const passportPaths: string[] = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    passportPaths.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({ ok: true, data: { needsEmailVerification: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const { internalAuthRouter } = await import("../server/internal-auth.js");
  const app = express();
  app.use("/api/internal-auth", internalAuthRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a port");
  const baseUrl = `http://127.0.0.1:${address.port}/api/internal-auth`;
  const request = (path: string, body: Record<string, unknown>) => nativeFetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://stmweb.example" },
    body: JSON.stringify(body),
  });

  try {
    const invalid = await request("register", { email: "user@example.com", password: "short" });
    assert.equal(invalid.status, 400);

    const registration = await request("register", { name: "用户", email: "USER@example.com", password: "password" });
    assert.equal(registration.status, 200);
    assert.deepEqual(await registration.json(), { success: true, needsEmailVerification: true, email: "user@example.com" });

    const recovery = await request("forgot-password", { email: "USER@example.com" });
    assert.equal(recovery.status, 200);
    assert.deepEqual(await recovery.json(), { success: true });
    assert.deepEqual(passportPaths, ["/api/v1/auth/register", "/api/v1/auth/forgot-password"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

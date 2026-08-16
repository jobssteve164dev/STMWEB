import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET = "12345678901234567890123456789012";
process.env.BETTER_AUTH_URL = "https://stmweb.example";
process.env.PASSPORT_PRODUCT = "stmweb";
process.env.SZLKLAWS_BASE_URL = "https://laws.example";

function requestJson(port: number, path: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode || 0, body: JSON.parse(body) as unknown }));
    }).on("error", reject);
  });
}

test("proxies shared and product-specific legal pages from SZLKLAWS", async (context) => {
  const upstreamUrls: string[] = [];
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    upstreamUrls.push(String(input));
    attempts += 1;
    if (attempts === 1) throw new TypeError("temporary DNS lookup failure");
    return new Response(JSON.stringify({ success: true, document: { title: "服务条款" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const express = (await import("express")).default;
  const { legalApiRouter } = await import("../server/legal-api.js");
  const app = express().use("/api/legal", legalApiRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  context.after(() => {
    globalThis.fetch = originalFetch;
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");

  assert.equal((await requestJson(address.port, "/api/legal/terms")).status, 200);
  assert.equal((await requestJson(address.port, "/api/legal/legal-supplement")).status, 200);

  assert.equal(upstreamUrls.length, 3);
  const shared = new URL(upstreamUrls[1]);
  assert.equal(shared.origin, "https://laws.example");
  assert.equal(shared.pathname, "/api/legal/document");
  assert.equal(shared.searchParams.get("product"), "stmweb");
  assert.equal(shared.searchParams.get("type"), "terms_of_service");
  assert.equal(shared.searchParams.get("locale"), "zh-CN");

  const supplement = new URL(upstreamUrls[2]);
  assert.equal(supplement.pathname, "/api/legal/product-supplement");
  assert.equal(supplement.searchParams.get("product"), "stmweb");
  assert.equal(supplement.searchParams.has("type"), false);
});

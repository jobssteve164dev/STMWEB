import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("device gateway completes enrollment, grant, lease, result and idempotent replay", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
  process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
  process.env.SZLK_PASSPORT_URL = "https://passport.example";
  process.env.SZLK_PASSPORT_SECRET = "test-product-secret";

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://passport.example") return new Response(JSON.stringify({ ok: true, data: { allowed: true, featureKey: "paid_subscription" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return nativeFetch(input, init);
  };

  const express = (await import("express")).default;
  const { pool } = await import("../server/database.js");
  const { migrateDatabase } = await import("../server/migrate.js");
  const { deviceApiRouter, deviceGatewayErrorHandler, deviceGatewayRouter } = await import("../server/device-gateway.js");
  await migrateDatabase();

  const suffix = randomBytes(6).toString("hex");
  const apiCredential = `stmweb_api_${randomBytes(32).toString("base64url")}`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO internal_users (username,display_name,passport_user_id,email) VALUES ($1,'网关测试用户',$2,$1) RETURNING id`,
    [`gateway-${suffix}@example.com`, `passport-${suffix}`],
  );
  const workspaces = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name,slug,owner_user_id) VALUES ('网关工作区',$1,$3),('隔离工作区',$2,$3) RETURNING id`,
    [`gateway-${suffix}`, `gateway-other-${suffix}`, user.rows[0].id],
  );
  for (const workspace of workspaces.rows) await pool.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')`, [workspace.id, user.rows[0].id]);
  const connection = await pool.query<{ id: string }>(
    `INSERT INTO api_connections (user_id,workspace_id,name,purpose,scopes,credential_hash,credential_hint)
     VALUES ($1,$2,'测试助手','网关端到端测试',ARRAY['devices:read','devices:manage','devices:control'],$3,$4) RETURNING id`,
    [user.rows[0].id, workspaces.rows[0].id, createHash("sha256").update(apiCredential).digest("hex"), apiCredential.slice(-6)],
  );

  const app = express();
  app.use("/api/device/v1", deviceApiRouter, deviceGatewayErrorHandler);
  app.use("/api/v1", deviceGatewayRouter, deviceGatewayErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const userHeaders = { Authorization: `Bearer ${apiCredential}`, "Content-Type": "application/json" };

  try {
    const enrollmentResponse = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/device-enrollments`, { method: "POST", headers: userHeaders, body: JSON.stringify({ providerName: "测试通知设备" }) });
    assert.equal(enrollmentResponse.status, 201);
    const enrollment = await enrollmentResponse.json() as { enrollment: { code: string } };

    const exchangeResponse = await fetch(`${origin}/api/device/v1/enrollments/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: enrollment.enrollment.code }) });
    assert.equal(exchangeResponse.status, 201);
    const exchange = await exchangeResponse.json() as { credential: string; providerId: string };
    assert.equal((await fetch(`${origin}/api/device/v1/enrollments/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: enrollment.enrollment.code }) })).status, 409);
    const providerHeaders = { Authorization: `Bearer ${exchange.credential}`, "Content-Type": "application/json" };

    const deviceResponse = await fetch(`${origin}/api/device/v1/devices`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ providerDeviceId: "notification-test", name: "测试通知设备", model: "notification-device-v1", firmwareVersion: "1" }) });
    assert.equal(deviceResponse.status, 201);
    const device = await deviceResponse.json() as { device: { id: string } };
    const manifest = {
      schemaVersion: 1, manifestVersion: "test-1", device: { id: device.device.id, model: "notification-device-v1", firmwareVersion: "1" },
      actions: [{ name: "speech.say", label: "说话", description: "朗读文字", inputSchema: { type: "object", additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 500 } }, required: ["text"] }, resultSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 0 } }, required: ["durationMs"] }, defaultTimeoutMs: 15_000, maximumTimeoutMs: 30_000, interruptible: true, status: "online" }],
    };
    assert.equal((await fetch(`${origin}/api/device/v1/devices/${device.device.id}/capabilities`, { method: "PUT", headers: providerHeaders, body: JSON.stringify(manifest) })).status, 200);

    const grantResponse = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/device-grants`, { method: "POST", headers: userHeaders, body: JSON.stringify({ connectionId: connection.rows[0].id, deviceId: device.device.id, actions: ["speech.say"] }) });
    assert.equal(grantResponse.status, 201);
    assert.equal((await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[1].id}/gateway`, { headers: userHeaders })).status, 403);

    const idempotencyKey = randomUUID();
    const operationRequest = { method: "POST", headers: { ...userHeaders, "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ action: "speech.say", arguments: { text: "任务完成" }, queueIfOffline: true }) };
    const createdResponse = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/devices/${device.device.id}/operations`, operationRequest);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { operation: { id: string } };
    const replay = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/devices/${device.device.id}/operations`, operationRequest);
    assert.equal((await replay.json() as { operation: { id: string } }).operation.id, created.operation.id);

    const leaseResponse = await fetch(`${origin}/api/device/v1/operations/lease`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ waitMs: 0 }) });
    const lease = await leaseResponse.json() as { operation: { id: string; leaseId: string; nextEventSequence: number } };
    assert.equal(lease.operation.id, created.operation.id);
    let sequence = lease.operation.nextEventSequence;
    for (const event of [
      { status: "accepted", eventId: "accepted-1" },
      { status: "running", eventId: "running-1" },
      { status: "succeeded", eventId: "succeeded-1", result: { durationMs: 12 } },
    ]) {
      const eventResponse = await fetch(`${origin}/api/device/v1/operations/${created.operation.id}/events`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ leaseId: lease.operation.leaseId, sequence: sequence++, payload: {}, ...event }) });
      assert.equal(eventResponse.status, 200);
    }
    const duplicateEvent = await fetch(`${origin}/api/device/v1/operations/${created.operation.id}/events`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ leaseId: lease.operation.leaseId, sequence: sequence, eventId: "succeeded-1", status: "succeeded", result: { durationMs: 12 }, payload: {} }) });
    assert.equal(duplicateEvent.status, 200);

    const finalResponse = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/device-operations/${created.operation.id}`, { headers: userHeaders });
    const final = await finalResponse.json() as { operation: { status: string; result: { durationMs: number } } };
    assert.equal(final.operation.status, "succeeded");
    assert.equal(final.operation.result.durationMs, 12);
    const eventsResponse = await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/device-operations/${created.operation.id}/events`, { headers: userHeaders });
    const events = await eventsResponse.json() as { events: Array<{ status: string }> };
    assert.deepEqual(events.events.map((event) => event.status), ["queued", "leased", "accepted", "running", "succeeded"]);

    assert.equal((await fetch(`${origin}/api/device/v1/heartbeat`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ deviceIds: [randomUUID()] }) })).status, 403);
    assert.equal((await fetch(`${origin}/api/v1/workspaces/${workspaces.rows[0].id}/device-providers/${exchange.providerId}/revoke`, { method: "POST", headers: userHeaders, body: "{}" })).status, 200);
    assert.equal((await fetch(`${origin}/api/device/v1/heartbeat`, { method: "POST", headers: providerHeaders, body: JSON.stringify({ deviceIds: [device.device.id] }) })).status, 401);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query(`DELETE FROM workspaces WHERE id=ANY($1::uuid[])`, [workspaces.rows.map((item) => item.id)]);
    await pool.query(`DELETE FROM internal_users WHERE id=$1`, [user.rows[0].id]);
    await pool.end();
  }
});

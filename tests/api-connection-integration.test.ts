import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("Bearer API connection enforces scope, workspace and revocation", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
  process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";

  const express = (await import("express")).default;
  const { pool } = await import("../server/database.js");
  const { migrateDatabase } = await import("../server/migrate.js");
  const { apiRouter } = await import("../server/api.js");
  await migrateDatabase();

  const suffix = randomBytes(6).toString("hex");
  const credential = `stmweb_api_${randomBytes(32).toString("base64url")}`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO internal_users (username,display_name,passport_user_id,email)
     VALUES ($1,'API 测试用户',$2,$1) RETURNING id`,
    [`api-${suffix}@example.com`, `passport-${suffix}`],
  );
  const workspaces = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name,slug,owner_user_id) VALUES
      ('授权工作区',$1,$3),('其他工作区',$2,$3) RETURNING id`,
    [`authorized-${suffix}`, `other-${suffix}`, user.rows[0].id],
  );
  for (const workspace of workspaces.rows) {
    await pool.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')`, [workspace.id, user.rows[0].id]);
  }
  const connection = await pool.query<{ id: string }>(
    `INSERT INTO api_connections (user_id,workspace_id,name,purpose,scopes,credential_hash,credential_hint)
     VALUES ($1,$2,'集成测试','验证权限边界',ARRAY['devices:read'], $3,$4) RETURNING id`,
    [user.rows[0].id, workspaces.rows[0].id, createHash("sha256").update(credential).digest("hex"), credential.slice(-6)],
  );

  const app = express();
  app.use("/api/v1", apiRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" };

  try {
    const bootstrap = await fetch(`${base}/bootstrap`, { headers });
    assert.equal(bootstrap.status, 200);
    const bootstrapBody = await bootstrap.json() as { workspaces: Array<{ id: string }> };
    assert.deepEqual(bootstrapBody.workspaces.map((item) => item.id), [workspaces.rows[0].id]);

    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/devices`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/devices`, {
      method: "POST", headers, body: JSON.stringify({ name: "越权设备" }),
    })).status, 403);
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[1].id}/devices`, { headers })).status, 403);

    await pool.query(`UPDATE api_connections SET status='revoked',revoked_at=now() WHERE id=$1`, [connection.rows[0].id]);
    assert.equal((await fetch(`${base}/bootstrap`, { headers })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query(`DELETE FROM internal_users WHERE id=$1`, [user.rows[0].id]);
    await pool.end();
  }
});

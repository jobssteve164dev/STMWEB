import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

function intelHexRecord(address: number, type: number, bytes: Uint8Array): string {
  const record = [bytes.byteLength, address >> 8 & 0xff, address & 0xff, type, ...bytes];
  const checksum = (-record.reduce((sum, value) => sum + value, 0)) & 0xff;
  return `:${[...record, checksum].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function embedHexPayload(source: Buffer, absoluteAddress: number, payload: Buffer): Buffer {
  const lines = source.toString("utf8").split(/\r?\n/).filter((line) => line && !line.startsWith(":00000001"));
  lines.push(intelHexRecord(0, 4, Uint8Array.from([absoluteAddress >>> 24 & 0xff, absoluteAddress >>> 16 & 0xff])));
  for (let offset = 0; offset < payload.byteLength; offset += 16) {
    lines.push(intelHexRecord((absoluteAddress + offset) & 0xffff, 0, payload.subarray(offset, offset + 16)));
  }
  lines.push(":00000001FF");
  return Buffer.from(`${lines.join("\n")}\n`);
}

test("Bearer API connection enforces scope, workspace and revocation", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
  process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
  process.env.SZLK_PASSPORT_URL = "https://passport.example";
  process.env.SZLK_PASSPORT_SECRET = "test-product-secret";

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://passport.example") {
      return new Response(JSON.stringify({ ok: true, data: { allowed: true, featureKey: "paid_subscription" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return nativeFetch(input, init);
  };

  const express = (await import("express")).default;
  const { pool } = await import("../server/database.js");
  const { migrateDatabase } = await import("../server/migrate.js");
  const { apiRouter } = await import("../server/api.js");
  const { cloudmcpProviderRouter } = await import("../server/cloudmcp-provider.js");
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
     VALUES ($1,$2,'集成测试','验证权限边界',ARRAY['devices:read','builds:create','artifacts:read'], $3,$4) RETURNING id`,
    [user.rows[0].id, workspaces.rows[0].id, createHash("sha256").update(credential).digest("hex"), credential.slice(-6)],
  );
  await pool.query(`UPDATE api_connections SET scopes=scopes||'builds:read'::text WHERE id=$1`, [connection.rows[0].id]);

  const app = express();
  app.use("/api/v1", apiRouter);
  app.use("/api/provider-bridge", cloudmcpProviderRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const providerBase = `http://127.0.0.1:${address.port}/api/provider-bridge`;
  const headers = { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" };

  try {
    const bootstrap = await fetch(`${base}/bootstrap`, { headers });
    assert.equal(bootstrap.status, 200);
    const bootstrapBody = await bootstrap.json() as { workspaces: Array<{ id: string }> };
    assert.deepEqual(bootstrapBody.workspaces.map((item) => item.id), [workspaces.rows[0].id]);

    const templatesResponse = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/hardware-projects/templates`, { headers });
    assert.equal(templatesResponse.status, 200);
    const templatesBody = await templatesResponse.json() as { templates: Array<{ hardwareProfileId: string; adapterVersion: string; target: string; capabilityModules: Array<{ id: string; defaultEnabled: boolean }>; connectionModules: Array<{ id: string; defaultEnabled: boolean; required: boolean }> }> };
    const compactTemplate = templatesBody.templates.find((item) => item.target === "stm32f103c8");
    assert.ok(compactTemplate);
    const selectedModuleIds = [...compactTemplate.capabilityModules, ...compactTemplate.connectionModules]
      .filter((module) => module.defaultEnabled || module.required).map((module) => module.id);
    const hardwareProjectResponse = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/hardware-projects`, {
      method: "POST", headers, body: JSON.stringify({ name: "DOT 64K 集成测试", ...compactTemplate, selectedModuleIds }),
    });
    assert.equal(hardwareProjectResponse.status, 201);
    const hardwareProjectBody = await hardwareProjectResponse.json() as { hardwareProject: { id: string } };
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/hardware-projects`, {
      method: "POST", headers, body: JSON.stringify({ name: "DOT 64K 集成测试", ...compactTemplate, selectedModuleIds }),
    })).status, 409);

    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/devices`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/devices`, {
      method: "POST", headers, body: JSON.stringify({ name: "越权设备" }),
    })).status, 403);
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[1].id}/devices`, { headers })).status, 403);

    const providerTools = await fetch(providerBase, {
      method: "POST", headers, body: JSON.stringify({ tool: "list_tools", params: {} }),
    });
    assert.equal(providerTools.status, 200);
    const providerToolBody = await providerTools.json() as { result: Array<{ name: string }> };
    assert.equal(providerToolBody.result.some((item) => item.name === "create_stmweb_runner_pairing"), true);
    assert.equal((await fetch(providerBase, {
      method: "POST", headers, body: JSON.stringify({ tool: "list_stmweb_debug_state", params: {} }),
    })).status, 403);
    assert.equal((await fetch(providerBase, {
      method: "POST", headers: { Authorization: "Bearer legacy-provider-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_tools", params: {} }),
    })).status, 401);

    const firmwareBytes = readFileSync("public/firmware/dot-v1/dot_v1_compact_application.bin");
    const mismatchedFirmware = new FormData();
    mismatchedFirmware.set("file", new Blob([firmwareBytes]), "dot-compact.bin");
    mismatchedFirmware.set("sha256", "0".repeat(64));
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware`, {
      method: "POST", headers: { Authorization: `Bearer ${credential}` }, body: mismatchedFirmware,
    })).status, 400);

    const firmwareForm = new FormData();
    firmwareForm.set("file", new Blob([firmwareBytes]), "dot-compact.bin");
    const firmwareUpload = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware`, {
      method: "POST", headers: { Authorization: `Bearer ${credential}` }, body: firmwareForm,
    });
    assert.equal(firmwareUpload.status, 201);
    const firmwareBody = await firmwareUpload.json() as { firmware: { id: string; sha256: string; hardwareProfileId: string; artifactRole: string; flashMethods: string[]; flashSize: number; status: string } };
    assert.equal(firmwareBody.firmware.sha256, createHash("sha256").update(firmwareBytes).digest("hex"));
    assert.equal(firmwareBody.firmware.hardwareProfileId, "stmweb.dot-v1");
    assert.equal(firmwareBody.firmware.artifactRole, "application");
    assert.deepEqual(firmwareBody.firmware.flashMethods, ["swd", "bluetooth"]);
    assert.equal(firmwareBody.firmware.flashSize, 64 * 1024);
    assert.equal(firmwareBody.firmware.status, "verified");

    const firmwareList = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware`, { headers });
    assert.equal(firmwareList.status, 200);
    const firmwareListBody = await firmwareList.json() as { firmware: Array<{ id: string; hardwareProfileId: string }> };
    assert.equal(firmwareListBody.firmware.length, 1);
    assert.equal(firmwareListBody.firmware[0].hardwareProfileId, "stmweb.dot-v1");
    assert.equal((await fetch(`${base}/workspaces/${workspaces.rows[1].id}/firmware`, { headers })).status, 403);
    const firmwareContent = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware/${firmwareBody.firmware.id}/content`, { headers });
    assert.equal(firmwareContent.status, 200);
    assert.deepEqual(Buffer.from(await firmwareContent.arrayBuffer()), firmwareBytes);

    const { getFirmwareAdapterTarget, resolveFirmwareConfiguration } = await import("../server/firmware-adapter-registry.js");
    const registeredAdapter = getFirmwareAdapterTarget("stmweb.dot-v1", "1", "stm32f103c8");
    assert.ok(registeredAdapter);
    const firmwareConfiguration = resolveFirmwareConfiguration(registeredAdapter.adapter, registeredAdapter.target, [
      "capability.motor-control", "capability.battery", "capability.tuning", "capability.telemetry", "connection.swd", "connection.bluetooth",
    ]);
    const configurationPayload = Buffer.from(`STMWEB_COMPOSITION:${JSON.stringify(firmwareConfiguration)}`);
    const generatedApplicationBytes = Buffer.concat([firmwareBytes, configurationPayload, Buffer.from([0])]);
    const completeBytes = embedHexPayload(
      readFileSync("public/firmware/dot-v1/dot_v1_compact_initial_swd.hex"),
      0x08001000 + firmwareBytes.byteLength,
      Buffer.concat([configurationPayload, Buffer.from([0])]),
    );
    const sourceBytes = Buffer.from("phase-b-source");
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const runner = await pool.query<{ id: string }>(
      `INSERT INTO build_runners (workspace_id,name,token_hash,capabilities,status,last_seen_at)
       VALUES ($1,'集成测试 Runner',$2,'{}'::jsonb,'online',now()) RETURNING id`,
      [workspaces.rows[0].id, createHash("sha256").update(randomBytes(32)).digest("hex")],
    );
    const job = await pool.query<{ id: string }>(
      `INSERT INTO build_jobs
         (workspace_id,runner_id,hardware_project_id,created_by,name,profile,target,adapter_version,runtime_version,firmware_configuration,source_name,source_sha256,source_content,status,progress)
       VALUES ($1,$2,$3,$4,'DOT 标准固件','stm32-cmake-gcc-v1','stm32f103c8','1','1',$5::jsonb,'source.zip',$6,$7,'running',100) RETURNING id`,
      [workspaces.rows[0].id, runner.rows[0].id, hardwareProjectBody.hardwareProject.id, user.rows[0].id, JSON.stringify(firmwareConfiguration), sourceSha256, sourceBytes],
    );
    const generatedArtifacts = [
      { buildFile: "dot_v1_initial_swd.hex", role: "complete-image", format: "ihex", flashMethods: ["swd"], bytes: completeBytes, kind: "hex" },
      { buildFile: "dot_v1.bin", role: "application", format: "bin", flashMethods: ["swd", "bluetooth"], bytes: generatedApplicationBytes, kind: "bin" },
    ].map((item) => ({ ...item, size: item.bytes.byteLength, sha256: createHash("sha256").update(item.bytes).digest("hex") }));
    const generatedManifest = {
      schemaVersion: 1,
      adapter: { id: "stmweb.dot-v1", version: "1" },
      hardware: { profileId: "stmweb.dot-v1", revision: "1", target: "stm32f103c8", mcuFamily: "stm32f103", deviceIds: [1040], flashBytes: 65536 },
      runtime: { version: "1", debugProtocol: "1", bootProtocol: "1", transports: ["swd", "bluetooth-uart"] },
      memory: { applicationBase: 0x08001000, applicationLimit: 0x0800fc00 },
      artifacts: generatedArtifacts.map(({ bytes: _bytes, kind: _kind, ...artifact }) => artifact),
      validation: { status: "verified", checks: ["vectors", "layout", "capacity", "factory-metadata", "sha256"] },
      source: { name: "source.zip", sha256: sourceSha256 },
      build: { profile: "stm32-cmake-gcc-v1", target: "stm32f103c8", environmentVersion: "test" },
      composition: firmwareConfiguration,
    };
    for (const artifact of generatedArtifacts) {
      await pool.query(
        `INSERT INTO build_artifacts (job_id,name,kind,sha256,size,content) VALUES ($1,$2,$3,$4,$5,$6)`,
        [job.rows[0].id, artifact.buildFile, artifact.kind, artifact.sha256, artifact.size, artifact.bytes],
      );
    }
    const manifestBytes = Buffer.from(JSON.stringify(generatedManifest));
    await pool.query(
      `INSERT INTO build_artifacts (job_id,name,kind,sha256,size,content) VALUES ($1,'firmware-manifest.json','report',$2,$3,$4)`,
      [job.rows[0].id, createHash("sha256").update(manifestBytes).digest("hex"), manifestBytes.byteLength, manifestBytes],
    );
    const registrationClient = await pool.connect();
    let packageId: string;
    try {
      const { registerGeneratedFirmwarePackage } = await import("../server/firmware-package-registration.js");
      packageId = await registerGeneratedFirmwarePackage(registrationClient, job.rows[0].id);
    } finally { registrationClient.release(); }
    await pool.query(`UPDATE build_jobs SET status='succeeded',finished_at=now() WHERE id=$1`, [job.rows[0].id]);

    const generatedList = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware`, { headers });
    assert.equal(generatedList.status, 200);
    const generatedListBody = await generatedList.json() as { firmware: Array<{ packageId: string | null; artifactRole: string; status: string }> };
    assert.equal(generatedListBody.firmware.filter((item) => item.packageId === packageId).length, 2);
    assert.deepEqual(generatedListBody.firmware.filter((item) => item.packageId === packageId).map((item) => item.artifactRole).sort(), ["application", "complete-image"]);
    const stableResponse = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/firmware-packages/${packageId}/stable`, { method: "POST", headers, body: "{}" });
    assert.equal(stableResponse.status, 200);
    const buildsResponse = await fetch(`${base}/workspaces/${workspaces.rows[0].id}/builds`, { headers });
    assert.equal(buildsResponse.status, 200);
    const buildsBody = await buildsResponse.json() as { builds: Array<{ id: string; packageId: string; packageStatus: string }> };
    assert.equal(buildsBody.builds.find((item) => item.id === job.rows[0].id)?.packageId, packageId);
    assert.equal(buildsBody.builds.find((item) => item.id === job.rows[0].id)?.packageStatus, "stable");

    await pool.query(`UPDATE api_connections SET status='revoked',revoked_at=now() WHERE id=$1`, [connection.rows[0].id]);
    assert.equal((await fetch(`${base}/bootstrap`, { headers })).status, 401);
    assert.equal((await fetch(providerBase, {
      method: "POST", headers, body: JSON.stringify({ tool: "list_tools", params: {} }),
    })).status, 401);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [workspaces.rows.map((item) => item.id)]);
    await pool.query(`DELETE FROM internal_users WHERE id=$1`, [user.rows[0].id]);
    await pool.end();
  }
});

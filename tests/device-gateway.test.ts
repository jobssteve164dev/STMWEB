import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
process.env.STMWEB_ADMIN_USERNAME ||= "admin";
process.env.STMWEB_ADMIN_PASSWORD ||= "test-password-long-enough";

const { DEVICE_GATEWAY_OPENAPI, validateJsonSchema } = await import("../server/device-gateway.js");

const speechSchema = {
  type: "object",
  additionalProperties: false,
  properties: { text: { type: "string", minLength: 1, maxLength: 500 } },
  required: ["text"],
};

test("validates capability arguments without accepting undeclared fields", () => {
  assert.deepEqual(validateJsonSchema({ text: "任务完成" }, speechSchema), []);
  assert.match(validateJsonSchema({}, speechSchema)[0], /text/);
  assert.match(validateJsonSchema({ text: "", shell: "reboot" }, speechSchema).join(" "), /内容太短/);
  assert.match(validateJsonSchema({ text: "完成", shell: "reboot" }, speechSchema).join(" "), /不受支持/);
});

test("publishes both northbound and southbound versioned contracts", () => {
  assert.equal(DEVICE_GATEWAY_OPENAPI.openapi, "3.1.0");
  assert.ok(DEVICE_GATEWAY_OPENAPI.paths["/api/device/v1/operations/lease"]);
  assert.ok(DEVICE_GATEWAY_OPENAPI.paths["/api/device/v1/credentials/rotate"]);
  assert.ok(DEVICE_GATEWAY_OPENAPI.paths["/api/v1/workspaces/{workspaceId}/devices/{deviceId}/operations"]);
  assert.ok(DEVICE_GATEWAY_OPENAPI.paths["/api/v1/workspaces/{workspaceId}/device-operations/{operationId}/events"]);
});

test("migration keeps device providers separate and leases with row locking", () => {
  const migration = readFileSync("server/migrate.ts", "utf8");
  const gateway = readFileSync("server/device-gateway.ts", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS device_providers/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS device_grants/);
  assert.match(migration, /UNIQUE \(workspace_id, caller_key, idempotency_key\)/);
  assert.match(gateway, /FOR UPDATE OF o SKIP LOCKED/);
  assert.doesNotMatch(gateway, /cloudmcp|provider-bridge|build_runners/);
});

test("duplicate device events remain scoped to the authenticated provider lease", () => {
  const gateway = readFileSync("server/device-gateway.ts", "utf8");
  assert.match(gateway, /o\.provider_id=\$3 AND o\.workspace_id=\$4 AND o\.lease_id=\$5/);
});

test("example provider keeps credentials out of console output", () => {
  const provider = readFileSync("scripts/stmweb-device-provider.mjs", "utf8");
  assert.doesNotMatch(provider, /console\.(?:log|error)\([^\n]*credential/);
  assert.match(provider, /mode: 0o600/);
  assert.match(provider, /state\.completed\[operation\.id\]/);
});

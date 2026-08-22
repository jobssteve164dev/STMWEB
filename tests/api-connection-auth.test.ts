import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
process.env.STMWEB_ADMIN_USERNAME ||= "admin";
process.env.STMWEB_ADMIN_PASSWORD ||= "test-password-long-enough";

const { requiredApiScope, API_SCOPES } = await import("../server/api-connection-auth.js");

test("maps public user API operations to stable scopes", () => {
  assert.equal(requiredApiScope("GET", "/workspaces/a/devices"), "devices:read");
  assert.equal(requiredApiScope("POST", "/workspaces/a/devices"), "devices:manage");
  assert.equal(requiredApiScope("POST", "/workspaces/a/device-enrollments"), "devices:manage");
  assert.equal(requiredApiScope("POST", "/workspaces/a/devices/b/operations"), "devices:control");
  assert.equal(requiredApiScope("GET", "/workspaces/a/device-operations/b/events"), "devices:read");
  assert.equal(requiredApiScope("POST", "/workspaces/a/device-operations/b/cancel"), "devices:control");
  assert.equal(requiredApiScope("GET", "/bootstrap"), null);
  assert.equal(requiredApiScope("POST", "/workspaces/a/runners/pairing"), "runners:manage");
  assert.equal(requiredApiScope("POST", "/workspaces/a/builds"), "builds:create");
  assert.equal(requiredApiScope("GET", "/workspaces/a/builds/b"), "builds:read");
  assert.equal(requiredApiScope("POST", "/workspaces/a/builds/b/cancel"), "builds:cancel");
  assert.equal(requiredApiScope("GET", "/workspaces/a/builds/b/artifacts/c"), "artifacts:read");
  assert.equal(requiredApiScope("GET", "/workspaces/a/firmware/b/content"), "artifacts:read");
  assert.equal(requiredApiScope("POST", "/workspaces/a/firmware-packages/b/stable"), "builds:create");
  assert.equal(requiredApiScope("GET", "/workspaces/a/sessions/b"), "debug:read");
  assert.equal(requiredApiScope("POST", "/api-connections"), null);
  assert.equal(new Set(API_SCOPES).size, API_SCOPES.length);
});

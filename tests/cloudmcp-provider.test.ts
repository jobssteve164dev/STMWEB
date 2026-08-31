import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
process.env.STMWEB_ADMIN_USERNAME ||= "admin";
process.env.STMWEB_ADMIN_PASSWORD ||= "test-password-long-enough";
process.env.STMWEB_BUILD_IMAGE_ID = "";
process.env.CLOUDMCP_BRIDGE_CLIENT_ID = "";
process.env.CLOUDMCP_BRIDGE_CLIENT_SECRET = "";
process.env.CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT = "";

const { STMWEB_CLOUDMCP_TOOLS } = await import("../server/cloudmcp-provider.js");
const { standardFirmwareSource } = await import("../server/firmware-standard-source.js");

test("selects platform standard source by the exact adapter identity", () => {
  assert.ok(standardFirmwareSource("stmweb.cardputer-adv", "1", "esp32s3fn8"));
  assert.equal(standardFirmwareSource("stmweb.cardputer-adv", "2", "esp32s3fn8"), null);
  assert.equal(standardFirmwareSource("stmweb.cardputer-adv", "1", "another-target"), null);
});

test("CloudMCP provider exposes only implemented STMWEB operations", () => {
  assert.deepEqual(STMWEB_CLOUDMCP_TOOLS.map((tool) => tool.name), [
    "list_stmweb_debug_state",
    "create_stmweb_runner_pairing",
    "start_stmweb_firmware_build",
    "get_stmweb_firmware_build",
    "cancel_stmweb_firmware_build",
    "get_stmweb_debug_session",
  ]);
  assert.equal(STMWEB_CLOUDMCP_TOOLS.some((tool) => tool.name.includes("flash")), false);
  const build = STMWEB_CLOUDMCP_TOOLS.find((tool) => tool.name === "start_stmweb_firmware_build");
  assert.deepEqual("required" in build!.inputSchema ? build!.inputSchema.required : [], ["runner_id", "hardware_project_id"]);
  assert.equal("target" in build!.inputSchema.properties, false);
  assert.equal("hardware_project_id" in build!.inputSchema.properties, true);
  assert.doesNotMatch(build!.description, /STM32|ESP32/i);
});

test("CloudMCP provider deployment uses the public environment contract", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const provider = readFileSync("server/cloudmcp-provider.ts", "utf8");
  assert.match(compose, /CLOUDMCP_BRIDGE_CLIENT_ID:/);
  assert.match(compose, /CLOUDMCP_BRIDGE_CLIENT_SECRET:/);
  assert.doesNotMatch(compose, /STMWEB_CLOUDMCP_BRIDGE_CLIENT/);
  assert.match(provider, /resolveApiConnectionCredential/);
  assert.match(provider, /user_api_bearer_v1/);
  assert.doesNotMatch(provider, /STMWEB_ADMIN_USERNAME|CLOUDMCP_BRIDGE_CLIENT_SECRET/);
  assert.match(provider, /capabilities->>'backend'='docker'/);
  assert.match(provider, /supportedAdapterTargets/);
  assert.match(provider, /hardware_projects:/);
  assert.match(provider, /requiresExternalSource/);
});

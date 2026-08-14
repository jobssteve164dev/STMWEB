import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
process.env.STMWEB_ADMIN_USERNAME ||= "admin";
process.env.STMWEB_ADMIN_PASSWORD ||= "test-password-long-enough";
process.env.STMWEB_BUILD_IMAGE_ID = "";
process.env.STMWEB_CLOUDMCP_BRIDGE_CLIENT_ID = "";
process.env.STMWEB_CLOUDMCP_BRIDGE_CLIENT_SECRET = "";
process.env.STMWEB_CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT = "";

const { STMWEB_CLOUDMCP_TOOLS } = await import("../server/cloudmcp-provider.js");

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
  assert.deepEqual("required" in build!.inputSchema ? build!.inputSchema.required : [], ["runner_id", "repository", "source_revision", "target"]);
});

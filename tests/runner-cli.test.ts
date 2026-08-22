import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("runner doctor reports its immutable build capability contract", () => {
  const result = spawnSync(process.execPath, ["runner/stmweb-runner.mjs", "doctor"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    version: string;
    capabilities: { architecture: string; firmwareCompositionVersion: number; maxConcurrentBuilds: number; toolchains: Array<{ id: string; targets: string[] }> };
  };
  assert.equal(report.version, "0.2.0");
  assert.equal(report.capabilities.architecture, process.arch);
  assert.equal(report.capabilities.firmwareCompositionVersion, 1);
  assert.equal(report.capabilities.maxConcurrentBuilds, 1);
  assert.equal(report.capabilities.toolchains[0]?.id, "arm-none-eabi-gcc");
  assert.ok(Array.isArray(report.capabilities.toolchains[0]?.targets));
});

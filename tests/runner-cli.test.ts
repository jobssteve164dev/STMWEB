import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runner doctor reports its immutable build capability contract", () => {
  const result = spawnSync(process.execPath, ["runner/stmweb-runner.mjs", "doctor"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    version: string;
    capabilities: { architecture: string; firmwareCompositionVersion: number; maxConcurrentBuilds: number; supportedAdapterTargets: unknown[]; toolchains: Array<{ id: string; targets: string[] }> };
  };
  assert.equal(report.version, "0.3.11");
  assert.equal(report.capabilities.architecture, process.arch);
  assert.equal(report.capabilities.firmwareCompositionVersion, 2);
  assert.equal(report.capabilities.maxConcurrentBuilds, 1);
  assert.ok(Array.isArray(report.capabilities.supportedAdapterTargets));
  assert.equal(report.capabilities.toolchains[0]?.id, "arm-none-eabi-gcc");
  assert.ok(Array.isArray(report.capabilities.toolchains[0]?.targets));
});

test("runner uploads firmware artifacts in resumable chunks", () => {
  const runner = readFileSync("runner/stmweb-runner.mjs", "utf8");
  const api = readFileSync("server/runner-api.ts", "utf8");
  assert.match(runner, /X-Artifact-Offset/);
  assert.match(runner, /X-Artifact-Total-Size/);
  assert.match(api, /x-artifact-offset/);
  assert.match(api, /octet_length\(content\)/);
  assert.match(api, /status IN \('leased','running'\) FOR UPDATE/);
  assert.match(api, /RETURNING content/);
});

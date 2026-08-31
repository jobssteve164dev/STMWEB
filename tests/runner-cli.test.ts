import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("runner doctor reports its immutable build capability contract", () => {
  const result = spawnSync(process.execPath, ["runner/stmweb-runner.mjs", "doctor"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, RUNNER_TARGET_CPU_CORES: "2", RUNNER_TARGET_MEMORY_MB: "2048" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    version: string;
    capabilities: { architecture: string; firmwareCompositionVersion: number; maxConcurrentBuilds: number; supportedAdapterTargets: unknown[]; toolchains: Array<{ id: string; targets: string[] }> };
  };
  assert.equal(report.version, "0.3.12");
  assert.equal(report.capabilities.architecture, process.arch);
  assert.equal(report.capabilities.firmwareCompositionVersion, 2);
  assert.equal(report.capabilities.maxConcurrentBuilds, 1);
  assert.ok(Array.isArray(report.capabilities.supportedAdapterTargets));
  assert.equal(report.capabilities.toolchains[0]?.id, "arm-none-eabi-gcc");
  assert.ok(Array.isArray(report.capabilities.toolchains[0]?.targets));
});

test("runner uploads firmware artifacts in resumable chunks", () => {
  const runner = readFileSync("runner/stmweb-runner.mjs", "utf8");
  const installer = readFileSync("runner/install-runner-package.sh", "utf8");
  const directInstaller = readFileSync("runner/install-runner.sh", "utf8");
  const api = readFileSync("server/runner-api.ts", "utf8");
  assert.match(runner, /X-Artifact-Offset/);
  assert.match(runner, /X-Artifact-Total-Size/);
  assert.match(runner, /RUNNER_TARGET_CPU_CORES/);
  assert.match(runner, /RUNNER_TARGET_MEMORY_MB/);
  assert.match(runner, /"--cpus", limits\.cpuCores/);
  assert.match(runner, /"--memory", `\$\{limits\.memoryMb\}m`/);
  assert.match(runner, /"--memory-swap", `\$\{limits\.memoryMb\}m`/);
  assert.match(installer, /RUNNER_TARGET_CPU_CORES/);
  assert.match(installer, /RUNNER_TARGET_MEMORY_MB/);
  assert.match(installer, /Environment="RUNNER_TARGET_CPU_CORES=/);
  assert.match(directInstaller, /--cpu-cores/);
  assert.match(directInstaller, /Environment="RUNNER_TARGET_CPU_CORES=/);
  assert.match(api, /x-artifact-offset/);
  assert.match(api, /octet_length\(content\)/);
  assert.match(api, /status IN \('leased','running'\) FOR UPDATE/);
  assert.match(api, /RETURNING content/);
});

test("runner turns a rejected completed package into one terminal failed event", async () => {
  const receivedTypes: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as { events?: Array<{ type: string }> } : {};
      if (request.url?.endsWith("/events")) {
        const type = body.events?.[0]?.type ?? "";
        receivedTypes.push(type);
        response.writeHead(type === "completed" ? 422 : 201, { "Content-Type": "application/json" });
        response.end(JSON.stringify(type === "completed" ? { error: "标准固件包缺少组合身份" } : { success: true }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(request.url?.endsWith("/heartbeat") ? { controls: [] } : { job: null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(path.join(tmpdir(), "stmweb-runner-rejection-"));
  const stateFile = path.join(directory, "state.json");
  writeFileSync(stateFile, JSON.stringify({
    controlUrl: `http://127.0.0.1:${address.port}`,
    runnerId: "22222222-2222-4222-8222-222222222222",
    deviceToken: "test-token",
    activeJob: null,
    pendingEvents: [{
      jobId: "33333333-3333-4333-8333-333333333333",
      leaseId: "44444444-4444-4444-8444-444444444444",
      events: [{ eventId: "completed-1", type: "completed", message: "构建完成", payload: { artifactCount: 2 } }],
    }],
  }));
  const child = spawn(process.execPath, ["runner/stmweb-runner.mjs", "connect", "--state-dir", directory], { cwd: process.cwd(), stdio: "ignore" });
  try {
    const deadline = Date.now() + 2_000;
    while (!receivedTypes.includes("failed") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(receivedTypes, ["completed", "failed"]);
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { pendingEvents: unknown[] };
    assert.deepEqual(state.pendingEvents, []);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    unlinkSync(stateFile);
    rmdirSync(directory);
  }
});

test("runner retries the same completed event after a transient control-plane failure", async () => {
  const received: Array<{ type: string; eventId: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as { events?: Array<{ type: string; eventId: string }> } : {};
      if (request.url?.endsWith("/events")) {
        const queued = body.events?.[0] ?? { type: "", eventId: "" };
        received.push(queued);
        response.writeHead(received.length === 1 ? 500 : 201, { "Content-Type": "application/json" });
        response.end(JSON.stringify(received.length === 1 ? { error: "database unavailable" } : { success: true }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(request.url?.endsWith("/heartbeat") ? { controls: [] } : { job: null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(path.join(tmpdir(), "stmweb-runner-retry-"));
  const stateFile = path.join(directory, "state.json");
  writeFileSync(stateFile, JSON.stringify({
    controlUrl: `http://127.0.0.1:${address.port}`,
    runnerId: "22222222-2222-4222-8222-222222222222",
    deviceToken: "test-token",
    activeJob: null,
    pendingEvents: [{
      jobId: "33333333-3333-4333-8333-333333333333",
      leaseId: "44444444-4444-4444-8444-444444444444",
      events: [{ eventId: "completed-stable-1", type: "completed", message: "构建完成", payload: { artifactCount: 2 } }],
    }],
  }));
  const child = spawn(process.execPath, ["runner/stmweb-runner.mjs", "connect", "--state-dir", directory], { cwd: process.cwd(), stdio: "ignore" });
  try {
    const deadline = Date.now() + 12_000;
    while (received.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(received.map(({ type, eventId }) => ({ type, eventId })), [
      { type: "completed", eventId: "completed-stable-1" },
      { type: "completed", eventId: "completed-stable-1" },
    ]);
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { pendingEvents: unknown[] };
    assert.deepEqual(state.pendingEvents, []);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    unlinkSync(stateFile);
    rmdirSync(directory);
  }
});

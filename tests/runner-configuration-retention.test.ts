import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

test("keeps the hardware project composition identity in a garbage-collected firmware link", () => {
  const runner = readFileSync("runner/stmweb-runner.mjs", "utf8");
  const start = runner.indexOf("function firmwareConfigurationSource");
  const end = runner.indexOf("\nasync function execute", start);
  assert.ok(start >= 0 && end > start);
  const context = { Buffer, configurationSource: "" };
  vm.runInNewContext(`${runner.slice(start, end)}\nconfigurationSource = firmwareConfigurationSource({schemaVersion:2});`, context);

  const directory = mkdtempSync(path.join(tmpdir(), "stmweb-config-retention-"));
  const configurationFile = path.join(directory, "configuration.c");
  const mainFile = path.join(directory, "main.c");
  const firmwareFile = path.join(directory, "firmware");
  try {
    writeFileSync(configurationFile, context.configurationSource);
    writeFileSync(mainFile, "int main(void) { return 0; }\n");
    execFileSync("cc", ["-ffunction-sections", "-fdata-sections", configurationFile, mainFile, "-Wl,--gc-sections", "-o", firmwareFile]);
    assert.equal(readFileSync(firmwareFile).includes(Buffer.from("STMWEB_COMPOSITION:{\"schemaVersion\":2}")), true);
  } finally {
    for (const file of [configurationFile, mainFile, firmwareFile]) {
      try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    rmdirSync(directory);
  }
});

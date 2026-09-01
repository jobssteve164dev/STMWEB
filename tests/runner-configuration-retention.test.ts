import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

test("keeps the hardware project composition identity without linker-supported retain", () => {
  const runner = readFileSync("runner/stmweb-runner.mjs", "utf8");
  const cardputerBuild = readFileSync("firmware-adapters/cardputer-adv/main/CMakeLists.txt", "utf8");
  const start = runner.indexOf("function firmwareConfigurationSource");
  const end = runner.indexOf("\nasync function execute", start);
  assert.ok(start >= 0 && end > start);
  const context = { Buffer, configurationSource: "" };
  vm.runInNewContext(`${runner.slice(start, end)}\nconfigurationSource = firmwareConfigurationSource({schemaVersion:2});`, context);

  const directory = mkdtempSync(path.join(tmpdir(), "stmweb-config-retention-"));
  const configurationFile = path.join(directory, "configuration.c");
  const configurationObject = path.join(directory, "configuration.o");
  const configurationArchive = path.join(directory, "libconfiguration.a");
  const mainFile = path.join(directory, "main.c");
  const firmwareFile = path.join(directory, "firmware");
  try {
    writeFileSync(configurationFile, context.configurationSource);
    writeFileSync(mainFile, "int main(void) { return 0; }\n");
    assert.match(cardputerBuild, /target_link_libraries\(\$\{COMPONENT_LIB\} INTERFACE "-u stmweb_firmware_configuration"\)/);
    execFileSync("cc", ["-ffunction-sections", "-fdata-sections", "-c", configurationFile, "-o", configurationObject]);
    execFileSync("ar", ["rcs", configurationArchive, configurationObject]);
    execFileSync("cc", [mainFile, configurationArchive, "-Wl,--gc-sections,-u,stmweb_firmware_configuration", "-o", firmwareFile]);
    assert.equal(readFileSync(firmwareFile).includes(Buffer.from("STMWEB_COMPOSITION:{\"schemaVersion\":2}")), true);
  } finally {
    for (const file of [configurationFile, configurationObject, configurationArchive, mainFile, firmwareFile]) {
      try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    rmdirSync(directory);
  }
});

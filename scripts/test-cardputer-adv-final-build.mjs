import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const runnerFile = path.resolve(argument("--runner", path.join(repositoryRoot, "runner/stmweb-runner.mjs")));
const adapterRoot = path.resolve(argument("--adapter", path.join(repositoryRoot, "firmware-adapters/cardputer-adv")));
const compositionFile = path.resolve(argument("--composition", path.join(repositoryRoot, "tests/fixtures/cardputer-adv-composition.json")));
const buildParent = path.resolve(argument("--build-dir", process.env.TMPDIR || "/tmp"));
const idfPath = process.env.IDF_PATH;

assert.ok(idfPath, "IDF_PATH must point to ESP-IDF 5.4.2");
const runner = readFileSync(runnerFile, "utf8");
function runnerFunction(name, nextDeclaration) {
  const start = runner.indexOf(`function ${name}`);
  const end = runner.indexOf(`\n${nextDeclaration}`, start);
  assert.ok(start >= 0 && end > start, `Runner ${name} is unavailable`);
  return runner.slice(start, end);
}

const composition = JSON.parse(readFileSync(compositionFile, "utf8"));
const context = { Buffer, createHash, structuredClone, composition, canonicalComposition: null, configurationSource: "" };
vm.runInNewContext(`
${runnerFunction("sha256", "function canonicalJson")}
${runnerFunction("canonicalJson", "function shellQuote")}
${runnerFunction("canonicalFirmwareConfiguration", "function firmwareConfigurationSource")}
${runnerFunction("firmwareConfigurationSource", "async function execute")}
canonicalComposition = canonicalFirmwareConfiguration(composition);
configurationSource = firmwareConfigurationSource(canonicalComposition);
`, context);
const canonicalComposition = JSON.parse(JSON.stringify(context.canonicalComposition));

mkdirSync(buildParent, { recursive: true });
const buildRoot = mkdtempSync(path.join(buildParent, "stmweb-cardputer-adv-final-build-"));
const configurationFile = path.join(buildRoot, "stmweb_firmware_configuration.c");
const buildDirectory = path.join(buildRoot, "build");
const sdkconfigFile = path.join(buildRoot, "sdkconfig");
writeFileSync(configurationFile, context.configurationSource, { mode: 0o600 });

const build = spawnSync("bash", ["-lc", `
  set -Eeuo pipefail
  . "$IDF_PATH/export.sh" >/dev/null
  test "$(idf.py --version)" = "ESP-IDF v5.4.2"
  idf.py -C "$1" -B "$2" -DSDKCONFIG="$3" -DSTMWEB_CONFIGURATION_SOURCE="$4" -DSTMWEB_COMPOSITION_FILE="$5" build
`, "stmweb-cardputer-final-build", adapterRoot, buildDirectory, sdkconfigFile, configurationFile, compositionFile], {
  encoding: "utf8",
  env: { ...process.env, IDF_PATH: idfPath },
  maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
assert.equal(build.status, 0, "Cardputer ADV must pass the real ESP-IDF final link and image build");

const otaFile = path.join(buildDirectory, "cardputer_adv_ota.bin");
const completeFile = path.join(buildDirectory, "cardputer_adv_complete.bin");
const manifestFile = path.join(buildDirectory, "stmweb_firmware_manifest.json");
const ota = readFileSync(otaFile);
const complete = readFileSync(completeFile);
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const compositionMarker = Buffer.from(`STMWEB_COMPOSITION:${JSON.stringify(canonicalComposition)}`);

assert.ok(ota.length > 0 && complete.length > ota.length, "final firmware images must be non-empty and complete");
assert.ok(ota.includes(Buffer.from("STMWEB_ADAPTER:stmweb.cardputer-adv")), "OTA image must retain the Cardputer adapter identity");
assert.ok(ota.includes(compositionMarker), "OTA image must retain the hardware project composition identity");
assert.ok(complete.includes(compositionMarker), "complete image must retain the hardware project composition identity");
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.adapter?.id, "stmweb.cardputer-adv");
assert.equal(manifest.adapter?.version, "1");
assert.equal(manifest.hardware?.target, "esp32s3fn8");
assert.deepEqual(manifest.composition, canonicalComposition);
assert.equal(manifest.artifacts?.length, 2);
for (const artifact of manifest.artifacts) {
  const bytes = readFileSync(path.join(buildDirectory, artifact.buildFile));
  assert.equal(artifact.size, bytes.length);
  assert.equal(artifact.sha256, createHash("sha256").update(bytes).digest("hex"));
}
assert.deepEqual(manifest.artifacts.map(({ buildFile, role, flashMethods }) => ({ buildFile, role, flashMethods })), [
  { buildFile: "cardputer_adv_complete.bin", role: "complete-image", flashMethods: ["usb"] },
  { buildFile: "cardputer_adv_ota.bin", role: "application", flashMethods: ["usb", "bluetooth"] },
]);

process.stdout.write(`cardputer_adv_final_build=ok\nbuild_directory=${buildDirectory}\n`);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync("Dockerfile", "utf8");

assert.match(dockerfile, /^COPY public \.\/public$/m, "Docker build does not include public firmware assets");
const manifestPath = "firmware/dot-v1/manifest.json";
const sourceManifest = readFileSync(`public/${manifestPath}`);
const deployedManifest = readFileSync(`dist/${manifestPath}`);
assert.deepEqual(deployedManifest, sourceManifest, "deployed DOT firmware manifest differs from the verified source manifest");
const manifest = JSON.parse(sourceManifest.toString("utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.hardwareProfileId, "stmweb.dot-v1");
for (const variant of manifest.variants) for (const artifact of variant.artifacts) {
  const assetPath = artifact.url.replace(/^\//, "");
  const source = readFileSync(`public/${assetPath}`);
  const deployed = readFileSync(`dist/${assetPath}`);
  assert.deepEqual(deployed, source, `deployed firmware ${assetPath} differs from the verified source asset`);
  assert.equal(source.byteLength, artifact.size, `firmware ${assetPath} size differs from its manifest`);
  assert.equal(createHash("sha256").update(source).digest("hex"), artifact.sha256, `firmware ${assetPath} digest differs from its manifest`);
  if (artifact.format !== "ihex") continue;
  for (const [index, sourceLine] of deployed.toString("utf8").split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line) continue;
    assert.equal(line[0], ":", `deployed firmware ${assetPath} line ${index + 1} is not an Intel HEX record`);
  }
}

process.stdout.write("deployed DOT firmware package verified\n");

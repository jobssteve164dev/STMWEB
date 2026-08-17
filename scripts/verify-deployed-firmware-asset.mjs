import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const assetPath = "firmware/dot-v1/dot_v1_initial_swd.hex";
const source = readFileSync(`public/${assetPath}`, "utf8");
const deployed = readFileSync(`dist/${assetPath}`, "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

assert.match(dockerfile, /^COPY public \.\/public$/m, "Docker build does not include public firmware assets");
assert.equal(deployed, source, "deployed DOT initial firmware differs from the verified source asset");

for (const [index, sourceLine] of deployed.split(/\r?\n/).entries()) {
  const line = sourceLine.trim();
  if (!line) continue;
  assert.equal(line[0], ":", `deployed DOT initial firmware line ${index + 1} is not an Intel HEX record`);
}

process.stdout.write("deployed DOT initial firmware asset verified\n");

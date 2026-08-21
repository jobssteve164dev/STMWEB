import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync("Dockerfile", "utf8");

assert.match(dockerfile, /^COPY public \.\/public$/m, "Docker build does not include public firmware assets");
for (const assetPath of ["firmware/dot-v1/dot_v1_initial_swd.hex", "firmware/dot-v1/dot_v1_compact_initial_swd.hex"]) {
  const source = readFileSync(`public/${assetPath}`, "utf8");
  const deployed = readFileSync(`dist/${assetPath}`, "utf8");
  assert.equal(deployed, source, `deployed firmware ${assetPath} differs from the verified source asset`);
  for (const [index, sourceLine] of deployed.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line) continue;
    assert.equal(line[0], ":", `deployed firmware ${assetPath} line ${index + 1} is not an Intel HEX record`);
  }
}

process.stdout.write("deployed DOT initial firmware assets verified\n");

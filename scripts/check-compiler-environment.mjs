import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(file, "utf8");
const [workflow, release, installer, runner, dockerfile, schema] = await Promise.all([
  read(".github/workflows/compiler-image.yml"),
  read("scripts/build-compiler-environment-release.sh"),
  read("runner/install-runner.sh"),
  read("runner/stmweb-runner.mjs"),
  read("runner/image/Dockerfile"),
  read("contracts/compiler-environment.schema.json"),
]);

JSON.parse(schema);
assert.match(workflow, /platforms: linux\/amd64/);
assert.match(workflow, /load: true[\s\S]*provenance: false[\s\S]*sbom: false/);
assert.match(workflow, /build-compiler-environment-release\.sh/);
assert.match(release, /docker save/);
assert.match(release, /imageId/);
assert.match(installer, /docker image inspect/);
assert.match(installer, /BUILD_IMAGE_ID/);
assert.match(runner, /imageReady\(\)/);
assert.match(runner, /\/opt\/stmweb\/adapters\/dot-v1/);
assert.match(dockerfile, /COPY firmware-adapters\/dot-v1/);
process.stdout.write("compiler environment contract ok\n");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(file, "utf8");
const [workflow, release, installer, packageInstaller, packageBuilder, packageVerifier, runner, dockerfile, dockerignore, schema] = await Promise.all([
  read(".github/workflows/compiler-image.yml"),
  read("scripts/build-compiler-environment-release.sh"),
  read("runner/install-runner.sh"),
  read("runner/install-runner-package.sh"),
  read("scripts/build-firmware-compilation-release.sh"),
  read("scripts/verify-firmware-compilation-release.sh"),
  read("runner/stmweb-runner.mjs"),
  read("runner/image/Dockerfile"),
  read(".dockerignore"),
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
assert.doesNotMatch(installer, /command -v node/);
assert.match(installer, /--entrypoint node/);
assert.match(installer, /\/var\/run\/docker\.sock/);
assert.match(packageBuilder, /export-classic-docker-archive\.sh/);
assert.match(packageBuilder, /stmweb-firmware-compilation-linux-amd64/);
assert.match(packageBuilder, /build_context_bytes/);
assert.match(packageBuilder, /largest_source_contributors/);
assert.match(packageVerifier, /package member set is invalid/);
assert.match(packageInstaller, /--code-file \/run\/stmweb-pairing-code/);
assert.doesNotMatch(packageInstaller, /--code \"\$PAIRING_CODE\"/);
assert.match(packageInstaller, /STMWEB_FIRMWARE_COMPILATION_READY=1/);
assert.doesNotMatch(packageInstaller, /GITOPS_STMWEB_/);
assert.match(runner, /imageReady\(\)/);
assert.match(runner, /--code-file/);
assert.match(runner, /\/opt\/stmweb\/adapters\/dot-v1/);
assert.match(dockerfile, /COPY firmware-adapters\/dot-v1/);
assert.match(dockerfile, /FROM node:22-bookworm-slim/);
assert.match(dockerfile, /FROM docker:27-cli AS docker_cli/);
assert.match(dockerfile, /unzip/);
assert.match(dockerignore, /^\*\.tar\.gz$/m);
process.stdout.write("compiler environment contract ok\n");

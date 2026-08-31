import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(file, "utf8");
const [workflow, release, installer, packageInstaller, packageBuilder, packageVerifier, compilerImageTest, classicArchiveExporter, runner, dockerfile, webDockerfile, dockerignore, schema, adapter, cardputerAdapter, packageManifest, bootloader, serverEnv, compose, envExample] = await Promise.all([
  read(".github/workflows/compiler-image.yml"),
  read("scripts/build-compiler-environment-release.sh"),
  read("runner/install-runner.sh"),
  read("runner/install-runner-package.sh"),
  read("scripts/build-firmware-compilation-release.sh"),
  read("scripts/verify-firmware-compilation-release.sh"),
  read("scripts/test-firmware-compiler-image.sh"),
  read("scripts/export-classic-docker-archive.sh"),
  read("runner/stmweb-runner.mjs"),
  read("runner/image/Dockerfile"),
  read("Dockerfile"),
  read(".dockerignore"),
  read("contracts/compiler-environment.schema.json"),
  read("firmware-adapters/dot-v1/adapter.json"),
  read("firmware-adapters/cardputer-adv/adapter.json"),
  read("firmware-adapters/dot-v1/write-package-manifest.mjs"),
  read("firmware-adapters/dot-v1/stmweb_bootloader.c"),
  read("server/env.ts"),
  read("docker-compose.yml"),
  read(".env.example"),
]);

JSON.parse(schema);
const adapterContract = JSON.parse(adapter);
const cardputerContract = JSON.parse(cardputerAdapter);
assert.equal(adapterContract.adapterId, "stmweb.dot-v1");
assert.deepEqual(adapterContract.targets.map((target) => target.id), ["stm32f103c8", "stm32f103cb"]);
assert.equal(adapterContract.modules.connections.find((module) => module.id === "connection.bluetooth")?.buildFeatures.includes("dot.bluetooth-update"), true);
assert.equal(adapterContract.targets.every((target) => target.resources.some((resource) => resource.id === "board.usart3")), true);
assert.equal(cardputerContract.adapterId, "stmweb.cardputer-adv");
assert.equal(cardputerContract.buildProfile, "esp32s3-idf-v1");
assert.deepEqual(cardputerContract.targets.map((target) => target.id), ["esp32s3fn8"]);
assert.match(workflow, /platforms: linux\/amd64/);
assert.match(workflow, /load: true[\s\S]*provenance: false[\s\S]*sbom: false/);
assert.match(workflow, /build-compiler-environment-release\.sh/);
assert.match(workflow, /npm run test:compiler-image/);
assert.match(release, /docker save/);
assert.match(release, /imageId/);
assert.match(installer, /docker image inspect/);
assert.match(installer, /BUILD_IMAGE_ID/);
assert.doesNotMatch(installer, /command -v node/);
assert.match(installer, /--entrypoint node/);
assert.match(installer, /\/var\/run\/docker\.sock/);
assert.match(packageBuilder, /export-classic-docker-archive\.sh/);
assert.match(classicArchiveExporter, /find "\$SKOPEO_ARCHIVE" -maxdepth 0 -type f -delete/);
assert.match(classicArchiveExporter, /ln "\$SOURCE_LAYOUT\/\$layer_file" "\$CLASSIC_LAYOUT\/\$layer_dir\/layer\.tar"/);
assert.match(classicArchiveExporter, /-cf - -C "\$CLASSIC_LAYOUT"[\s\S]*\| gzip -n > "\$OUTPUT"/);
assert.doesNotMatch(classicArchiveExporter, /RAW_ARCHIVE/);
assert.match(packageBuilder, /stmweb-firmware-compilation-linux-amd64/);
assert.match(packageBuilder, /build_context_bytes/);
assert.match(packageBuilder, /largest_source_contributors/);
assert.match(packageVerifier, /package member set is invalid/);
assert.match(packageVerifier, /test-firmware-compiler-image\.sh/);
assert.match(compilerImageTest, /docker cp "\$SOURCE_ROOT\/\."/);
assert.match(compilerImageTest, /for target in stm32f103cb stm32f103c8/);
assert.match(compilerImageTest, /cmake --build "\$output" --parallel 1/);
assert.match(compilerImageTest, /verify-dot-initial-firmware\.mjs/);
assert.match(compilerImageTest, /cardputer_adv_ota\.bin/);
assert.match(compilerImageTest, /--entrypoint bash/);
assert.doesNotMatch(compilerImageTest, /--entrypoint sh/);
assert.match(packageInstaller, /--code-file \/run\/stmweb-pairing-code/);
assert.doesNotMatch(packageInstaller, /--code \"\$PAIRING_CODE\"/);
assert.match(packageInstaller, /EXISTING_REGISTRATION/);
assert.match(packageInstaller, /systemctl restart stmweb-runner/);
assert.match(packageInstaller, /STMWEB_FIRMWARE_COMPILATION_READY=1/);
assert.doesNotMatch(packageInstaller, /GITOPS_STMWEB_/);
assert.match(runner, /imageReady\(\)/);
assert.match(runner, /--code-file/);
assert.match(runner, /supportedAdapterTargets/);
assert.match(runner, /adapterBuildDirectory/);
assert.match(runner, /path\.join\(stateDir, \"build-history\"\)/);
assert.match(runner, /stmweb_firmware_manifest\.json/);
assert.match(runner, /STMWEB_COMPOSITION_FILE/);
assert.match(runner, /esp32s3-idf-v1/);
assert.match(runner, /idf\.py/);
assert.match(runner, /export IDF_PATH=\/opt\/esp\/idf/);
assert.match(runner, /BUILD_IMAGE, "bash", "-lc"/);
assert.doesNotMatch(runner, /BUILD_IMAGE, "sh", "-lc"/);
assert.match(runner, /stmweb\/compiler:v0\.3\.0/);
assert.match(serverEnv, /stmweb\/compiler:v0\.3\.0/);
assert.match(compose, /stmweb\/compiler:v0\.3\.0/);
assert.match(envExample, /stmweb\/compiler:v0\.3\.0/);
assert.match(installer, /ESP-IDF 5\.4\.2/);
assert.match(packageInstaller, /ESP-IDF 5\.4\.2/);
assert.match(installer, /docker run --rm "\$BUILD_IMAGE" bash -lc/);
assert.match(packageInstaller, /docker run --rm "\$BUILD_IMAGE" bash -lc/);
assert.doesNotMatch(installer, /docker run --rm "\$BUILD_IMAGE" sh -lc/);
assert.doesNotMatch(packageInstaller, /docker run --rm "\$BUILD_IMAGE" sh -lc/);
assert.match(installer, /export IDF_PATH=\/opt\/esp\/idf/);
assert.match(packageInstaller, /export IDF_PATH=\/opt\/esp\/idf/);
assert.match(runner, /compositionSha256/);
assert.match(runner, /canonicalJson\(content\)/);
assert.match(runner, /firmware-manifest\.json/);
assert.match(runner, /uploadArtifact\(state, job, logFile, "log"\)/);
assert.match(runner, /logText\.slice\(-12_000\)/);
assert.match(runner, /failureEvent\(state\.activeJob\.id, error\)/);
assert.match(runner, /failureEvent\(lease\.job\.id, error\)/);
assert.doesNotMatch(runner, /mkdtemp\(path\.join\(tmpdir\(\)/);
assert.match(dockerfile, /COPY firmware-adapters \/opt\/stmweb\/adapters/);
assert.match(webDockerfile, /COPY firmware-adapters \.\/firmware-adapters/);
assert.match(packageManifest, /stmweb_firmware_manifest\.json/);
assert.match(bootloader, /receiveFrames\(0u\);\s+return 0;/);
assert.match(dockerfile, /FROM node:22-bookworm-slim/);
assert.match(dockerfile, /FROM docker:27-cli AS docker_cli/);
assert.match(dockerfile, /FROM ubuntu:24\.04/);
assert.match(dockerfile, /ARG IDF_VERSION=v5\.4\.2/);
assert.match(dockerfile, /github\.com\/espressif\/esp-idf\.git/);
assert.match(dockerfile, /idf_tools\.py" --non-interactive install required --targets=esp32s3/);
assert.match(dockerfile, /COPY --from=node_runtime \/usr\/local \/usr\/local/);
assert.match(dockerfile, /IDF_PATH=\/opt\/esp\/idf/);
assert.match(dockerfile, /IDF_TOOLS_PATH=\/opt\/esp/);
assert.match(dockerfile, /IDF_PYTHON_CHECK_CONSTRAINTS=no/);
assert.match(dockerfile, /install-python-env[\s\S]*ENV IDF_PYTHON_CHECK_CONSTRAINTS=no/);
assert.match(dockerfile, /cmake/);
assert.match(dockerfile, /ninja-build/);
assert.match(dockerfile, /unzip/);
assert.match(dockerignore, /^\*\.tar\.gz$/m);
process.stdout.write("compiler environment contract ok\n");

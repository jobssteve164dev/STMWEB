import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { firmwareCompositionSchema, getFirmwareAdapterTarget, resolveFirmwareConfiguration, sameFirmwareComposition, verifyFirmwareComposition } from "./firmware-adapter-registry.js";
import { firmwareContainsPayload, inspectFirmwareArtifact } from "./firmware-artifact.js";

const manifestArtifactSchema = z.object({
  buildFile: z.string().min(1),
  role: z.enum(["complete-image", "application"]),
  format: z.enum(["ihex", "bin"]),
  flashMethods: z.array(z.enum(["swd", "usb", "bluetooth"])).min(1),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const generatedManifestSchema = z.object({
  schemaVersion: z.literal(1),
  adapter: z.object({ id: z.string(), version: z.string() }),
  hardware: z.object({ profileId: z.string(), revision: z.string(), target: z.string(), mcuFamily: z.string(), deviceIds: z.array(z.number()), flashBytes: z.number() }),
  runtime: z.object({ version: z.string(), debugProtocol: z.string(), bootProtocol: z.string(), transports: z.array(z.string()) }),
  memory: z.object({ applicationBase: z.number(), applicationLimit: z.number() }),
  artifacts: z.array(manifestArtifactSchema).length(2),
  validation: z.object({ status: z.literal("verified"), checks: z.array(z.string()).min(1) }),
  source: z.object({ name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  build: z.object({ profile: z.string(), target: z.string(), environmentVersion: z.string() }),
  composition: firmwareCompositionSchema,
});

interface BuildArtifactRow {
  name: string;
  kind: string;
  sha256: string;
  size: string;
  content: Buffer;
}

export async function registerGeneratedFirmwarePackage(client: PoolClient, jobId: string): Promise<string> {
  const jobResult = await client.query<{
    workspaceId: string; hardwareProjectId: string | null; createdBy: string; name: string; profile: string; target: string;
    sourceName: string; sourceSha256: string; adapterVersion: string | null; runtimeVersion: string | null; hardwareProfileId: string | null; firmwareConfiguration: unknown;
  }>(
    `SELECT j.workspace_id AS "workspaceId",j.hardware_project_id AS "hardwareProjectId",j.created_by AS "createdBy",
            j.name,j.profile,j.target,j.source_name AS "sourceName",j.source_sha256 AS "sourceSha256",
            j.adapter_version AS "adapterVersion",j.runtime_version AS "runtimeVersion",p.hardware_profile_id AS "hardwareProfileId",
            j.firmware_configuration AS "firmwareConfiguration"
     FROM build_jobs j LEFT JOIN hardware_projects p ON p.id=j.hardware_project_id WHERE j.id=$1`,
    [jobId],
  );
  const job = jobResult.rows[0];
  if (!job?.hardwareProjectId || !job.hardwareProfileId || !job.adapterVersion || !job.runtimeVersion) {
    throw new Error("构建没有绑定可验证的硬件项目");
  }
  const registered = getFirmwareAdapterTarget(job.hardwareProfileId, job.adapterVersion, job.target);
  if (!registered || registered.adapter.runtimeVersion !== job.runtimeVersion || registered.adapter.buildProfile !== job.profile) {
    throw new Error("构建使用的硬件适配版本已不可用");
  }
  const firmwareConfiguration = verifyFirmwareComposition(job.firmwareConfiguration);

  const artifactResult = await client.query<BuildArtifactRow>(
    `SELECT name,kind,sha256,size::text,content FROM build_artifacts WHERE job_id=$1`,
    [jobId],
  );
  const byName = new Map(artifactResult.rows.map((artifact) => [artifact.name, artifact]));
  const manifestArtifact = byName.get("firmware-manifest.json");
  if (!manifestArtifact || manifestArtifact.kind !== "report") throw new Error("Runner 没有提交标准固件清单");
  const rawManifest = JSON.parse(manifestArtifact.content.toString("utf8")) as { composition?: unknown };
  const manifest = generatedManifestSchema.parse(rawManifest);
  const { adapter, target } = registered;
  const expectedComposition = resolveFirmwareConfiguration(adapter, target, [
    ...firmwareConfiguration.capabilityModules,
    ...firmwareConfiguration.connectionModules,
  ]);
  if (!sameFirmwareComposition(expectedComposition, firmwareConfiguration)) {
    throw new Error("构建任务中的解析后组合图与硬件适配不一致");
  }
  if (manifest.adapter.id !== adapter.adapterId || manifest.adapter.version !== adapter.adapterVersion
    || manifest.hardware.profileId !== adapter.adapterId || manifest.hardware.revision !== adapter.adapterVersion
    || manifest.hardware.target !== target.id || manifest.hardware.mcuFamily !== target.mcuFamily
    || manifest.hardware.deviceIds.join(",") !== target.deviceIds.join(",")
    || manifest.hardware.flashBytes !== target.flashSize || manifest.runtime.version !== adapter.runtimeVersion
    || manifest.runtime.debugProtocol !== adapter.runtime.debugProtocol || manifest.runtime.bootProtocol !== adapter.runtime.bootProtocol
    || manifest.runtime.transports.join(",") !== firmwareConfiguration.runtimeTransports.join(",")
    || manifest.memory.applicationBase !== target.applicationBase || manifest.memory.applicationLimit !== target.applicationLimit
    || manifest.source.sha256 !== job.sourceSha256 || manifest.source.name !== job.sourceName
    || manifest.build.profile !== job.profile || manifest.build.target !== job.target
    || !sameFirmwareComposition(manifest.composition, firmwareConfiguration)) {
    throw new Error("标准固件清单与构建任务不一致");
  }

  for (const expected of target.artifacts) {
    const declared = manifest.artifacts.find((artifact) => artifact.role === expected.role);
    const expectedFlashMethods = expected.flashMethods.filter((method) => firmwareConfiguration.flashMethods.includes(method));
    if (!declared || declared.buildFile !== expected.buildFile || declared.format !== expected.format
      || declared.flashMethods.join(",") !== expectedFlashMethods.join(",")) {
      throw new Error("标准固件清单的制品合同与硬件适配不一致");
    }
  }

  const verifiedArtifacts = manifest.artifacts.map((descriptor) => {
    const artifact = byName.get(descriptor.buildFile);
    if (!artifact) throw new Error(`标准固件包缺少 ${descriptor.role === "complete-image" ? "完整固件" : "应用固件"}`);
    const actualSha256 = createHash("sha256").update(artifact.content).digest("hex");
    if (Number(artifact.size) !== descriptor.size || artifact.sha256 !== descriptor.sha256 || actualSha256 !== descriptor.sha256) {
      throw new Error(`标准固件包中的 ${descriptor.buildFile} 未通过完整性校验`);
    }
    const configurationPayload = new TextEncoder().encode(`STMWEB_COMPOSITION:${JSON.stringify(rawManifest.composition)}`);
    if (!firmwareContainsPayload(artifact.content, descriptor.buildFile, target, configurationPayload)) {
      throw new Error(`标准固件包中的 ${descriptor.buildFile} 没有包含本次固件组合身份`);
    }
    const inspected = inspectFirmwareArtifact(artifact.content, descriptor.buildFile, {
      hardwareProfileId: adapter.adapterId, adapterVersion: adapter.adapterVersion, target: target.id,
    });
    if (inspected.hardwareProfileId !== adapter.adapterId || inspected.artifactRole !== descriptor.role
      || inspected.flashSize !== target.flashSize || inspected.applicationBase !== target.applicationBase
      || inspected.applicationLimit !== target.applicationLimit || inspected.runtimeVersion !== adapter.runtimeVersion
      || inspected.status !== "verified" || descriptor.flashMethods.some((method) => !inspected.flashMethods.includes(method))) {
      throw new Error(`标准固件包中的 ${descriptor.buildFile} 与硬件适配不兼容`);
    }
    return { descriptor, artifact, inspected };
  });
  if (new Set(verifiedArtifacts.map((item) => item.descriptor.role)).size !== 2) throw new Error("标准固件包的制品角色不完整");

  const packageResult = await client.query<{ id: string }>(
    `INSERT INTO firmware_packages
       (workspace_id,hardware_project_id,build_job_id,created_by,name,hardware_profile_id,adapter_version,runtime_version,target,source_sha256,manifest,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'verified')
     ON CONFLICT (build_job_id) DO UPDATE SET manifest=EXCLUDED.manifest
     RETURNING id`,
    [job.workspaceId, job.hardwareProjectId, jobId, job.createdBy, job.name, adapter.adapterId, adapter.adapterVersion,
      adapter.runtimeVersion, target.id, job.sourceSha256, JSON.stringify(manifest)],
  );
  const packageId = packageResult.rows[0].id;
  for (const { descriptor, artifact, inspected } of verifiedArtifacts) {
    await client.query(
      `INSERT INTO firmware_package_artifacts
         (package_id,file_name,file_size,file_type,sha256,content,artifact_role,flash_methods,flash_size,application_base,application_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (package_id,artifact_role) DO UPDATE SET
         file_name=EXCLUDED.file_name,file_size=EXCLUDED.file_size,file_type=EXCLUDED.file_type,sha256=EXCLUDED.sha256,content=EXCLUDED.content,
         flash_methods=EXCLUDED.flash_methods,flash_size=EXCLUDED.flash_size,application_base=EXCLUDED.application_base,application_limit=EXCLUDED.application_limit`,
      [packageId, descriptor.buildFile, descriptor.size, inspected.fileType, descriptor.sha256, artifact.content, descriptor.role,
        descriptor.flashMethods, target.flashSize, target.applicationBase, target.applicationLimit],
    );
  }
  return packageId;
}

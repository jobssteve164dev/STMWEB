import { createHash } from "node:crypto";
import { allFirmwareAdapterTargets, getFirmwareAdapterTarget, type FirmwareAdapterTarget } from "./firmware-adapter-registry.js";

export type FirmwareArtifactRole = "complete-image" | "application" | "unclassified";
export type FirmwareFlashMethod = "swd" | "bluetooth";
export type FirmwareReleaseStatus = "draft" | "verified" | "stable" | "retired";

export interface FirmwareArtifactDescriptor {
  hardwareProfileId: string | null;
  artifactRole: FirmwareArtifactRole;
  flashMethods: FirmwareFlashMethod[];
  flashSize: number | null;
  applicationBase: number | null;
  applicationLimit: number | null;
  runtimeVersion: string | null;
  status: FirmwareReleaseStatus;
  fileType: string;
}

export interface PreparedFirmwareUpload extends FirmwareArtifactDescriptor {
  sha256: string;
}

const STM32_FLASH_BASE = 0x08000000;
const DOT_FACTORY_MAGIC = 0x31574653;
const DOT_FACTORY_CHECK = 0xcea8b9ac;
const registeredTargets = allFirmwareAdapterTargets();

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) return 0;
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function vectorsMatch(bytes: Uint8Array, vectorOffset: number, resetBase: number, resetLimit: number): boolean {
  const stack = readU32(bytes, vectorOffset);
  const reset = readU32(bytes, vectorOffset + 4);
  return stack >= 0x20000000 && stack <= 0x20005000
    && reset >= resetBase + 1 && reset < resetLimit && (reset & 1) === 1;
}

function inspectDotApplication(content: Uint8Array, candidates = registeredTargets): FirmwareArtifactDescriptor | null {
  if (content.byteLength < 8) return null;
  for (const { adapter, target } of candidates) {
    if (content.byteLength > target.applicationLimit - target.applicationBase) continue;
    if (!vectorsMatch(content, 0, target.applicationBase, target.applicationLimit)) continue;
    const contract = target.artifacts.find((artifact) => artifact.role === "application");
    if (!contract) continue;
    return {
      hardwareProfileId: adapter.adapterId,
      artifactRole: "application",
      flashMethods: [...contract.flashMethods],
      flashSize: target.flashSize,
      applicationBase: target.applicationBase,
      applicationLimit: target.applicationLimit,
      runtimeVersion: adapter.runtimeVersion,
      status: "verified",
      fileType: "BIN",
    };
  }
  return null;
}

function decodeHexRecord(line: string, lineNumber: number): Uint8Array {
  if (!/^:[0-9a-f]+$/i.test(line) || line.length % 2 === 0) {
    throw new Error(`固件第 ${lineNumber} 行不是有效 Intel HEX 记录`);
  }
  const matches = line.slice(1).match(/../g);
  if (!matches) throw new Error(`固件第 ${lineNumber} 行不是有效 Intel HEX 记录`);
  const record = Uint8Array.from(matches.map((value) => Number.parseInt(value, 16)));
  if (record.byteLength !== record[0] + 5) throw new Error(`固件第 ${lineNumber} 行长度无效`);
  if (record.reduce((sum, value) => (sum + value) & 0xff, 0) !== 0) throw new Error(`固件第 ${lineNumber} 行校验和无效`);
  return record;
}

function parseDotCompleteImage(source: string, target: FirmwareAdapterTarget): Uint8Array | null {
  const image = new Uint8Array(target.flashSize).fill(0xff);
  let upperAddress = 0;
  let eof = false;
  for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const record = decodeHexRecord(line, lineIndex + 1);
    const address = record[1] << 8 | record[2];
    const type = record[3];
    if (type === 0) {
      const absolute = upperAddress + address;
      if (absolute < STM32_FLASH_BASE || absolute + record[0] > STM32_FLASH_BASE + target.flashSize) return null;
      image.set(record.subarray(4, 4 + record[0]), absolute - STM32_FLASH_BASE);
    } else if (type === 1) {
      eof = true;
    } else if (type === 4) {
      if (record[0] !== 2) return null;
      upperAddress = (record[4] << 8 | record[5]) << 16;
    }
  }
  if (!eof) throw new Error("固件缺少 Intel HEX 结束记录");
  const appOffset = target.applicationBase - STM32_FLASH_BASE;
  const metadataOffset = target.applicationLimit - STM32_FLASH_BASE;
  return vectorsMatch(image, 0, STM32_FLASH_BASE, target.applicationBase)
    && vectorsMatch(image, appOffset, target.applicationBase, target.applicationLimit)
    && readU32(image, metadataOffset) === DOT_FACTORY_MAGIC
    && readU32(image, metadataOffset + 12) === DOT_FACTORY_CHECK ? image : null;
}

function inspectDotCompleteImage(content: Uint8Array, candidates = registeredTargets): FirmwareArtifactDescriptor | null {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  for (const { adapter, target } of candidates) {
    if (!parseDotCompleteImage(source, target)) continue;
    const contract = target.artifacts.find((artifact) => artifact.role === "complete-image");
    if (!contract) continue;
    return {
      hardwareProfileId: adapter.adapterId,
      artifactRole: "complete-image",
      flashMethods: [...contract.flashMethods],
      flashSize: target.flashSize,
      applicationBase: target.applicationBase,
      applicationLimit: target.applicationLimit,
      runtimeVersion: adapter.runtimeVersion,
      status: "verified",
      fileType: "HEX",
    };
  }
  return null;
}

function fallbackFileType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return extension?.slice(0, 32) || "FILE";
}

export function inspectFirmwareArtifact(
  content: Uint8Array,
  fileName: string,
  expected?: { hardwareProfileId: string; adapterVersion: string; target: string },
): FirmwareArtifactDescriptor {
  const registered = expected ? getFirmwareAdapterTarget(expected.hardwareProfileId, expected.adapterVersion, expected.target) : null;
  const candidates = expected ? registered ? [registered] : [] : registeredTargets;
  const looksLikeHex = content[0] === 0x3a || fileName.toLowerCase().endsWith(".hex");
  const recognized = looksLikeHex ? inspectDotCompleteImage(content, candidates) : inspectDotApplication(content, candidates);
  return recognized ?? {
    hardwareProfileId: null,
    artifactRole: "unclassified",
    flashMethods: [],
    flashSize: null,
    applicationBase: null,
    applicationLimit: null,
    runtimeVersion: null,
    status: "draft",
    fileType: fallbackFileType(fileName),
  };
}

export function prepareFirmwareUpload(content: Uint8Array, fileName: string, clientSha256?: string): PreparedFirmwareUpload {
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (clientSha256 && clientSha256 !== sha256) throw new Error("固件摘要与实际文件内容不一致");
  return { ...inspectFirmwareArtifact(content, fileName), sha256 };
}

function containsBytes(source: Uint8Array, expected: Uint8Array): boolean {
  if (!expected.byteLength || expected.byteLength > source.byteLength) return false;
  outer: for (let start = 0; start <= source.byteLength - expected.byteLength; start++) {
    for (let index = 0; index < expected.byteLength; index++) if (source[start + index] !== expected[index]) continue outer;
    return true;
  }
  return false;
}

export function firmwareContainsPayload(content: Uint8Array, fileName: string, target: FirmwareAdapterTarget, payload: Uint8Array): boolean {
  if (content[0] !== 0x3a && !fileName.toLowerCase().endsWith(".hex")) return containsBytes(content, payload);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  const image = parseDotCompleteImage(source, target);
  return image ? containsBytes(image, payload) : false;
}

import type { IEspLoaderTerminal } from "esptool-js";
import SparkMD5 from "spark-md5";
import type { FirmwareVersionRecord } from "./db.js";

export interface UsbFlashProgress {
  stage: "connecting" | "writing" | "restarting";
  percent: number;
  detail: string;
}

interface SerialNavigator extends Navigator {
  serial?: { requestPort(): Promise<unknown> };
}

export function usbFlashAddress(firmware: FirmwareVersionRecord): number {
  if (!firmware.flashMethods.includes("usb")) throw new Error("这份固件没有声明 USB 烧录支持");
  if (firmware.hardwareProfileId !== "stmweb.cardputer-adv") throw new Error("这份固件还没有可用的 USB 烧录驱动");
  if (firmware.artifactRole === "complete-image") return 0;
  throw new Error("USB 烧录目前只接受可验证的完整镜像；应用更新请使用蓝牙");
}

export function usbFlashBaudRate(value: number): number {
  if (!Number.isInteger(value)) throw new Error("刷写波特率必须是整数");
  if (value < 9600 || value > 2_000_000) throw new Error("刷写波特率必须在 9600 到 2000000 之间");
  return value;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return offset >= 0 && offset + 2 <= bytes.byteLength ? bytes[offset] | bytes[offset + 1] << 8 : 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return offset >= 0 && offset + 4 <= bytes.byteLength
    ? (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0 : 0;
}

async function inspectEsp32s3Image(bytes: Uint8Array, offset: number): Promise<number | null> {
  if (offset < 0 || offset + 24 > bytes.byteLength || bytes[offset] !== 0xe9 || readU16(bytes, offset + 12) !== 9) return null;
  const segmentCount = bytes[offset + 1];
  if (segmentCount < 1 || segmentCount > 16) return null;
  let cursor = offset + 24;
  let checksum = 0xef;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    if (cursor + 8 > bytes.byteLength) return null;
    const length = readU32(bytes, cursor + 4);
    cursor += 8;
    if (length > bytes.byteLength - cursor) return null;
    for (const byte of bytes.subarray(cursor, cursor + length)) checksum ^= byte;
    cursor += length;
  }
  const checksumOffset = ((cursor + 16) & ~15) - 1;
  if (checksumOffset >= bytes.byteLength || bytes[checksumOffset] !== checksum
    || bytes.subarray(cursor, checksumOffset).some((byte) => byte !== 0)) return null;
  const imageEnd = checksumOffset + 1;
  const hashAppended = bytes[offset + 23];
  if (hashAppended === 0) return imageEnd;
  if (hashAppended !== 1) return null;
  if (imageEnd + 32 > bytes.byteLength) return null;
  const digest = await sha256Hex(bytes.subarray(offset, imageEnd));
  const appendedDigest = [...bytes.subarray(imageEnd, imageEnd + 32)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return digest === appendedDigest ? imageEnd + 32 : null;
}

function inspectPartitionTable(bytes: Uint8Array, flashSize: number): Array<{ type: number; offset: number; size: number }> | null {
  const partitions: Array<{ type: number; offset: number; size: number }> = [];
  let tableComplete = false;
  for (let offset = 0x8000; offset + 32 <= Math.min(bytes.byteLength, 0x9000); offset += 32) {
    if (bytes[offset] === 0xff && bytes[offset + 1] === 0xff) { tableComplete = true; break; }
    if (bytes[offset] === 0xeb && bytes[offset + 1] === 0xeb) {
      const source = Uint8Array.from(bytes.subarray(0x8000, offset));
      const digest = SparkMD5.ArrayBuffer.hash(source.buffer);
      const expected = [...bytes.subarray(offset + 16, offset + 32)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== expected) return null;
      tableComplete = true;
      break;
    }
    if (bytes[offset] !== 0xaa || bytes[offset + 1] !== 0x50) return null;
    const type = bytes[offset + 2];
    const partitionOffset = readU32(bytes, offset + 4); const partitionSize = readU32(bytes, offset + 8);
    if (!partitionSize || partitionOffset < 0x9000 || partitionOffset + partitionSize > flashSize
      || partitions.some((partition) => partitionOffset < partition.offset + partition.size
        && partition.offset < partitionOffset + partitionSize)) return null;
    partitions.push({ type, offset: partitionOffset, size: partitionSize });
  }
  return tableComplete && partitions.length ? partitions : null;
}

function partitionTableMatches(bytes: Uint8Array, firmware: FirmwareVersionRecord): boolean {
  if (firmware.applicationBase === null || firmware.applicationLimit === null || firmware.flashSize === null) return false;
  const partitions = inspectPartitionTable(bytes, firmware.flashSize);
  return Boolean(partitions?.some((partition) => partition.type === 0 && partition.offset === firmware.applicationBase
    && partition.size === firmware.applicationLimit! - firmware.applicationBase!));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareLocalUsbFirmware(fileName: string, bytes: Uint8Array): Promise<FirmwareVersionRecord> {
  const flashSize = 8 * 1024 * 1024;
  const bootEnd = await inspectEsp32s3Image(bytes, 0);
  const partitions = bytes.byteLength <= flashSize ? inspectPartitionTable(bytes, flashSize) : null;
  let application: { type: number; offset: number; size: number } | undefined;
  for (const partition of partitions ?? []) {
    if (partition.type !== 0) continue;
    const imageEnd = await inspectEsp32s3Image(bytes, partition.offset);
    if (imageEnd !== null && imageEnd <= partition.offset + partition.size) { application = partition; break; }
  }
  if (!bootEnd || bootEnd > 0x8000 || !application) throw new Error("不是可验证的 Cardputer ADV 完整镜像");
  const sha256 = await sha256Hex(bytes);
  return {
    id: `local:${sha256}`,
    fileName,
    fileSize: bytes.byteLength,
    fileType: "BIN",
    sha256,
    hardwareProfileId: "stmweb.cardputer-adv",
    artifactRole: "complete-image",
    flashMethods: ["usb"],
    flashSize,
    applicationBase: application.offset,
    applicationLimit: application.offset + application.size,
    runtimeVersion: null,
    status: "verified",
    createdAt: new Date().toISOString(),
  };
}

export async function readLocalUsbFirmware(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<{ record: FirmwareVersionRecord; bytes: Uint8Array }> {
  if (file.size > 8 * 1024 * 1024) throw new Error("完整固件不能超过 8 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { record: await prepareLocalUsbFirmware(file.name, bytes), bytes };
}

export async function validateUsbFirmware(firmware: FirmwareVersionRecord, bytes: Uint8Array): Promise<void> {
  usbFlashAddress(firmware);
  if (firmware.flashSize === null || bytes.byteLength > firmware.flashSize) throw new Error("固件写入范围超出已验证的 Flash 容量");
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== firmware.sha256.toLowerCase()) throw new Error("固件 SHA-256 与已验证记录不一致");
  const bootEnd = await inspectEsp32s3Image(bytes, 0);
  const applicationEnd = firmware.applicationBase === null ? null : await inspectEsp32s3Image(bytes, firmware.applicationBase);
  if (!bootEnd || bootEnd > 0x8000 || !applicationEnd
    || firmware.applicationLimit === null || applicationEnd > firmware.applicationLimit
    || !partitionTableMatches(bytes, firmware)) {
    throw new Error("不是可验证的 Cardputer ADV 完整镜像");
  }
}

export async function flashFirmwareOverUsb(
  firmware: FirmwareVersionRecord,
  bytes: Uint8Array,
  onProgress: (progress: UsbFlashProgress) => void,
  baudRate = 460800,
): Promise<{ chipName: string }> {
  const address = usbFlashAddress(firmware);
  const verifiedBaudRate = usbFlashBaudRate(baudRate);
  await validateUsbFirmware(firmware, bytes);
  const serial = (navigator as SerialNavigator).serial;
  if (!serial) throw new Error("当前浏览器不支持 USB 串口烧录，请使用最新版 Chrome 或 Edge");

  onProgress({ stage: "connecting", percent: 1, detail: "请选择已进入下载模式的 USB 设备" });
  const port = await serial.requestPort();
  const { ESPLoader, Transport } = await import("esptool-js");
  const transport = new Transport(port as ConstructorParameters<typeof Transport>[0], false);
  const terminal: IEspLoaderTerminal = { clean() {}, writeLine() {}, write() {} };
  try {
    const loader = new ESPLoader({ transport, baudrate: verifiedBaudRate, terminal, debugLogging: false });
    const chipName = await loader.main();
    if (!chipName.toLowerCase().includes("esp32-s3")) throw new Error(`检测到 ${chipName}，与 Cardputer ADV 的 ESP32-S3 不匹配`);
    const flashSize = await loader.detectFlashSize();
    if (flashSize !== "8MB") throw new Error(`检测到 ${flashSize} Flash，与 Cardputer ADV 的 8MB 容量不匹配`);
    onProgress({ stage: "writing", percent: 5, detail: "正在写入 USB 固件" });
    await loader.writeFlash({
      fileArray: [{ data: bytes, address }],
      flashMode: "dio",
      flashFreq: "80m",
      flashSize: "8MB",
      eraseAll: false,
      compress: true,
      calculateMD5Hash: (image) => SparkMD5.ArrayBuffer.hash(Uint8Array.from(image).buffer),
      reportProgress: (_fileIndex, written, total) => onProgress({
        stage: "writing",
        percent: 5 + Math.round(written / total * 90),
        detail: "正在写入 USB 固件",
      }),
    });
    onProgress({ stage: "restarting", percent: 98, detail: "正在重启设备" });
    await loader.after("hard_reset");
    onProgress({ stage: "restarting", percent: 100, detail: "USB 烧录完成" });
    return { chipName };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

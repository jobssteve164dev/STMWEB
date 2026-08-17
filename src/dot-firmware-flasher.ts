import type { HardwareConnection } from "./hardware.js";

const FRAME_MAGIC = 0x574d5453;
const PROTOCOL_VERSION = 1;
const HEADER_LENGTH = 14;
const MAX_PAYLOAD = 256;
const APP_BASE = 0x08004000;
const APP_LIMIT = 0x0801fc00;
const STM32F103_MEDIUM_DEVICE_ID = 0x410;

const command = {
  hello: 0x01,
  begin: 0x02,
  data: 0x03,
  end: 0x04,
  abort: 0x05,
} as const;

const statusMessages: Record<number, string> = {
  1: "设备拒绝了无效升级帧",
  2: "设备当前不在可升级状态",
  3: "固件与当前芯片或 Flash 容量不匹配",
  4: "固件分块偏移不连续",
  5: "设备写入 Flash 失败",
  6: "设备未通过最终固件校验",
  7: "设备中没有可启动的应用",
};

export interface DotBootloaderInfo {
  flashSize: number;
  applicationBase: number;
  applicationCapacity: number;
  applicationValid: boolean;
  deviceId: number;
}

export interface DotFlashProgress {
  stage: "entering" | "checking" | "erasing" | "writing" | "verifying" | "restarting";
  percent: number;
}

export interface DotFlashResult {
  info: DotBootloaderInfo;
  firmwareCrc32: number;
  restartConfirmed: boolean;
}

interface BootResponse {
  command: number;
  sequence: number;
  status: number;
  payload: Uint8Array;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

export function validateDotApplication(bytes: Uint8Array): void {
  if (bytes.byteLength < 8) throw new Error("应用固件内容不完整");
  if (bytes.byteLength > APP_LIMIT - APP_BASE) throw new Error("应用固件超过 DOT V1 应用分区容量");
  const stack = readU32(bytes, 0);
  const reset = readU32(bytes, 4);
  if (stack < 0x20000000 || stack > 0x20005000) throw new Error("应用固件的栈地址不属于 STM32F103CB SRAM");
  if (reset < APP_BASE || reset >= APP_LIMIT || (reset & 1) === 0) {
    throw new Error("请选择从 0x08004000 启动的 DOT 蓝牙升级 BIN，不能使用初始 SWD HEX 或原始地址固件");
  }
}

export function encodeBootFrame(frameCommand: number, sequence: number, offset = 0, payload: Uint8Array<ArrayBufferLike> = new Uint8Array()): Uint8Array {
  if (payload.byteLength > MAX_PAYLOAD) throw new Error("升级分块超过协议上限");
  const frame = new Uint8Array(HEADER_LENGTH + payload.byteLength + 4);
  const view = new DataView(frame.buffer);
  writeU32(view, 0, FRAME_MAGIC);
  frame[4] = PROTOCOL_VERSION;
  frame[5] = frameCommand;
  view.setUint16(6, sequence, true);
  writeU32(view, 8, offset);
  view.setUint16(12, payload.byteLength, true);
  frame.set(payload, HEADER_LENGTH);
  writeU32(view, HEADER_LENGTH + payload.byteLength, crc32(frame.subarray(0, -4)));
  return frame;
}

export class DotBootResponseDecoder {
  private buffered = new Uint8Array();

  push(chunk: Uint8Array): BootResponse[] {
    const joined = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    joined.set(this.buffered);
    joined.set(chunk, this.buffered.byteLength);
    this.buffered = joined;
    const responses: BootResponse[] = [];

    while (this.buffered.byteLength >= 4) {
      if (readU32(this.buffered, 0) !== FRAME_MAGIC) {
        this.buffered = this.buffered.subarray(1);
        continue;
      }
      if (this.buffered.byteLength < HEADER_LENGTH) break;
      const length = this.buffered[12] | this.buffered[13] << 8;
      if (this.buffered[4] !== PROTOCOL_VERSION || length > MAX_PAYLOAD) {
        this.buffered = this.buffered.subarray(1);
        continue;
      }
      const frameLength = HEADER_LENGTH + length + 4;
      if (this.buffered.byteLength < frameLength) break;
      const frame = this.buffered.subarray(0, frameLength);
      if (crc32(frame.subarray(0, -4)) === readU32(frame, frameLength - 4)) {
        responses.push({
          command: frame[5],
          sequence: frame[6] | frame[7] << 8,
          status: readU32(frame, 8),
          payload: Uint8Array.from(frame.subarray(HEADER_LENGTH, HEADER_LENGTH + length)),
        });
        this.buffered = this.buffered.subarray(frameLength);
      } else {
        this.buffered = this.buffered.subarray(1);
      }
    }
    return responses;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

class DotBootClient {
  private decoder = new DotBootResponseDecoder();
  private sequence = 0;
  private listeners = new Set<(response: BootResponse) => void>();

  constructor(private connection: HardwareConnection) {}

  receive = (bytes: Uint8Array) => {
    for (const response of this.decoder.push(bytes)) {
      for (const listener of this.listeners) listener(response);
    }
  };

  private async writeFrame(frame: Uint8Array) {
    if (!this.connection.write) throw new Error("蓝牙写入通道不可用");
    for (let offset = 0; offset < frame.byteLength; offset += 20) {
      await this.connection.write(frame.subarray(offset, offset + 20));
      if (offset + 20 < frame.byteLength) await delay(8);
    }
  }

  async request(frameCommand: number, offset = 0, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), timeout = 3000): Promise<BootResponse> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.sequence = (this.sequence + 1) & 0xffff;
      const sequence = this.sequence;
      const frame = encodeBootFrame(frameCommand, sequence, offset, payload);
      try {
        const response = await new Promise<BootResponse>((resolve, reject) => {
          const listener = (candidate: BootResponse) => {
            if (candidate.sequence !== sequence || candidate.command !== (frameCommand | 0x80)) return;
            cleanup();
            resolve(candidate);
          };
          const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error("等待设备响应超时"));
          }, timeout);
          const cleanup = () => {
            window.clearTimeout(timer);
            this.listeners.delete(listener);
          };
          this.listeners.add(listener);
          void this.writeFrame(frame).catch((error) => { cleanup(); reject(error); });
        });
        if (response.status !== 0) throw new Error(statusMessages[response.status] || `设备返回升级错误 ${response.status}`);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("蓝牙升级请求失败");
        if (!lastError.message.includes("超时") || attempt === 2) throw lastError;
      }
    }
    throw lastError || new Error("蓝牙升级请求失败");
  }
}

function beginPayload(size: number, checksum: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  writeU32(view, 0, size);
  writeU32(view, 4, checksum);
  return payload;
}

function parseHello(payload: Uint8Array): DotBootloaderInfo {
  if (payload.byteLength < 20) throw new Error("设备 Bootloader 版本过旧，请先通过 SWD 写入新版初始固件");
  return {
    flashSize: readU32(payload, 0),
    applicationBase: readU32(payload, 4),
    applicationCapacity: readU32(payload, 8),
    applicationValid: readU32(payload, 12) !== 0,
    deviceId: readU32(payload, 16),
  };
}

function validateTarget(info: DotBootloaderInfo) {
  if ((info.deviceId & 0xfff) !== STM32F103_MEDIUM_DEVICE_ID || info.flashSize !== 128 * 1024) {
    throw new Error("连接的设备不是受支持的 STM32F103CB（128 KiB），烧录已停止");
  }
  if (info.applicationBase !== APP_BASE || info.applicationCapacity !== APP_LIMIT - APP_BASE) {
    throw new Error("设备 Bootloader 的应用分区与当前固件不匹配");
  }
}

async function waitForRestartData(connection: HardwareConnection): Promise<boolean> {
  return new Promise((resolve) => {
    let received = "";
    const timer = window.setTimeout(() => { connection.setDataHandler?.(null); resolve(false); }, 5000);
    connection.setDataHandler?.((bytes) => {
      received += new TextDecoder().decode(bytes);
      if (!/(?:bpy|biy|bdy|spy|siy|sdy|bat|pwm|dy)/.test(received)) return;
      window.clearTimeout(timer);
      connection.setDataHandler?.(null);
      resolve(true);
    });
  });
}

export async function flashDotApplication(
  connection: HardwareConnection,
  firmware: Uint8Array,
  onProgress: (progress: DotFlashProgress) => void,
): Promise<DotFlashResult> {
  if (connection.kind !== "bluetooth" || !connection.write || !connection.setDataHandler) throw new Error("请先通过蓝牙连接 DOT 小车");
  validateDotApplication(firmware);
  const client = new DotBootClient(connection);
  connection.setDataHandler(client.receive);
  const checksum = crc32(firmware);
  let began = false;
  try {
    onProgress({ stage: "entering", percent: 1 });
    await connection.write("STMWEB:BOOT");
    await delay(900);
    onProgress({ stage: "checking", percent: 3 });
    const info = parseHello((await client.request(command.hello, 0, new Uint8Array(), 5000)).payload);
    validateTarget(info);
    onProgress({ stage: "erasing", percent: 5 });
    await client.request(command.begin, 0, beginPayload(firmware.byteLength, checksum), 15_000);
    began = true;
    for (let offset = 0; offset < firmware.byteLength; offset += 128) {
      const payload = firmware.subarray(offset, Math.min(offset + 128, firmware.byteLength));
      await client.request(command.data, offset, payload, 4000);
      onProgress({ stage: "writing", percent: 5 + Math.round((offset + payload.byteLength) / firmware.byteLength * 90) });
    }
    onProgress({ stage: "verifying", percent: 96 });
    await client.request(command.end, 0, new Uint8Array(), 8000);
    began = false;
    onProgress({ stage: "restarting", percent: 99 });
    const restartConfirmed = await waitForRestartData(connection);
    onProgress({ stage: "restarting", percent: 100 });
    return { info, firmwareCrc32: checksum, restartConfirmed };
  } catch (error) {
    if (began) await client.request(command.abort).catch(() => undefined);
    throw error;
  } finally {
    connection.setDataHandler(null);
  }
}

export const dotFirmwareLayout = { applicationBase: APP_BASE, applicationLimit: APP_LIMIT } as const;

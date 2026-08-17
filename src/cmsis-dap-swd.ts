const DAP_INFO = 0x00;
const DAP_CONNECT = 0x02;
const DAP_DISCONNECT = 0x03;
const DAP_TRANSFER_CONFIGURE = 0x04;
const DAP_TRANSFER = 0x05;
const DAP_TRANSFER_BLOCK = 0x06;
const DAP_RESET_TARGET = 0x0a;
const DAP_SWJ_CLOCK = 0x11;
const DAP_SWJ_SEQUENCE = 0x12;
const DAP_SWD_CONFIGURE = 0x13;

const DP_IDCODE_READ = 0x02;
const DP_CTRL_STAT_READ = 0x06;
const DP_CTRL_STAT_WRITE = 0x04;
const DP_SELECT_WRITE = 0x08;
const AP_CSW_WRITE = 0x01;
const AP_TAR_WRITE = 0x05;
const AP_DRW_WRITE = 0x0d;
const AP_DRW_READ = 0x0f;

const STM32_FLASH_BASE = 0x08000000;
const STM32_FLASH_SIZE = 128 * 1024;
const STM32_FLASH_PAGE_SIZE = 1024;
const STM32_FLASH_SIZE_REGISTER = 0x1ffff7e0;
const STM32_DBGMCU_IDCODE = 0xe0042000;
const STM32F103_MEDIUM_DEVICE_ID = 0x410;
const STM32_FLASH_KEYR = 0x40022004;
const STM32_FLASH_SR = 0x4002200c;
const STM32_FLASH_CR = 0x40022010;
const STM32_FLASH_AR = 0x40022014;
const STM32_RCC_CR = 0x40021000;
const CORTEX_DHCSR = 0xe000edf0;
const CORTEX_AIRCR = 0xe000ed0c;

interface HidInputReportEventLike extends Event {
  data: DataView;
}

interface HidReportLike { reportId: number; reportSize?: number }
interface HidCollectionLike { outputReports?: HidReportLike[]; inputReports?: HidReportLike[] }
interface HidDeviceLike extends EventTarget {
  opened: boolean;
  productName?: string;
  collections?: HidCollectionLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

interface HidNavigatorLike extends Navigator {
  hid?: {
    getDevices?(): Promise<HidDeviceLike[]>;
    requestDevice(options: { filters: Array<Record<string, number>> }): Promise<HidDeviceLike[]>;
  };
}

interface UsbTransferInResultLike { data?: DataView; status?: string }
interface UsbTransferOutResultLike { status?: string }
interface UsbDeviceLike {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  configuration?: { configurationValue: number } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<UsbTransferOutResultLike>;
  transferIn(endpointNumber: number, length: number): Promise<UsbTransferInResultLike>;
}

interface UsbNavigatorLike extends Navigator {
  usb?: {
    getDevices(): Promise<UsbDeviceLike[]>;
    requestDevice(options: { filters: Array<{ vendorId: number; productId: number }> }): Promise<UsbDeviceLike>;
  };
}

interface CmsisDapPacketTransport {
  readonly probeName: string;
  readonly maxPacketSize: number;
  setMaxPacketSize(size: number): void;
  exchange(command: number, payload?: Uint8Array<ArrayBufferLike>, timeout?: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface SwdFlashProgress {
  stage: "connecting" | "checking" | "erasing" | "writing" | "verifying" | "restarting";
  percent: number;
  detail: string;
}

export interface SwdFlashResult {
  probeName: string;
  deviceId: number;
  flashSize: number;
  programmedBytes: number;
}

export interface ParsedInitialFirmware {
  image: Uint8Array;
  programmedBytes: number;
}

export function alignHalfwordTransferValues(address: number, values: number[]): number[] {
  return values.map((value, index) => ((address + index * 2) & 2) !== 0 ? (value << 16) >>> 0 : value & 0xffff);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | bytes[offset + 1] << 8;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export function parseDotInitialHex(source: string): ParsedInitialFirmware {
  const image = new Uint8Array(STM32_FLASH_SIZE).fill(0xff);
  let upperAddress = 0;
  let programmedBytes = 0;
  let eof = false;
  for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/^:[0-9a-f]+$/i.test(line) || line.length % 2 === 0) throw new Error(`初始固件第 ${lineIndex + 1} 行不是有效 Intel HEX 记录`);
    const record = Uint8Array.from(line.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16)));
    if (record.byteLength !== record[0] + 5) throw new Error(`初始固件第 ${lineIndex + 1} 行长度无效`);
    if (record.reduce((sum, value) => (sum + value) & 0xff, 0) !== 0) throw new Error(`初始固件第 ${lineIndex + 1} 行校验和无效`);
    const address = record[1] << 8 | record[2];
    const type = record[3];
    if (type === 0) {
      const absolute = upperAddress + address;
      if (absolute < STM32_FLASH_BASE || absolute + record[0] > STM32_FLASH_BASE + STM32_FLASH_SIZE) {
        throw new Error("初始固件包含 STM32F103CB Flash 之外的数据");
      }
      const targetOffset = absolute - STM32_FLASH_BASE;
      image.set(record.subarray(4, 4 + record[0]), targetOffset);
      programmedBytes += record[0];
    } else if (type === 1) eof = true;
    else if (type === 4) upperAddress = (record[4] << 8 | record[5]) << 16;
  }
  if (!eof) throw new Error("初始固件缺少结束记录");
  const bootStack = readU32(image, 0);
  const bootReset = readU32(image, 4);
  const appStack = readU32(image, 0x4000);
  const appReset = readU32(image, 0x4004);
  if (bootStack < 0x20000000 || bootStack > 0x20005000 || bootReset < 0x08000001 || bootReset >= 0x08004000 || (bootReset & 1) === 0) {
    throw new Error("初始固件 Bootloader 向量表无效");
  }
  if (appStack < 0x20000000 || appStack > 0x20005000 || appReset < 0x08004001 || appReset >= 0x0801fc00 || (appReset & 1) === 0) {
    throw new Error("初始固件应用向量表无效");
  }
  if (readU32(image, 0x1fc00) !== 0x31574653 || readU32(image, 0x1fc0c) !== 0xcea8b9ac) {
    throw new Error("初始固件缺少有效的工厂元数据");
  }
  return { image, programmedBytes };
}

class CmsisDapHidTransport implements CmsisDapPacketTransport {
  private packetSize = 64;
  private reportId = 0;
  private pending: { command: number; resolve: (value: Uint8Array) => void; reject: (error: Error) => void; timer: number } | null = null;

  constructor(private device: HidDeviceLike) {
    const report = device.collections?.flatMap((collection) => collection.outputReports || [])[0];
    this.reportId = report?.reportId ?? 0;
    this.packetSize = report?.reportSize ? Math.max(64, Math.ceil(report.reportSize / 8)) : 64;
    device.addEventListener("inputreport", this.handleInput as EventListener);
  }

  get probeName() { return this.device.productName || "CMSIS-DAP"; }

  private handleInput = (event: HidInputReportEventLike) => {
    const bytes = Uint8Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
    if (!this.pending || bytes[0] !== this.pending.command) return;
    window.clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = null;
    pending.resolve(bytes);
  };

  get maxPacketSize() { return this.packetSize; }
  setMaxPacketSize(size: number) { this.packetSize = Math.max(64, size); }

  async exchange(command: number, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), timeout = 5000): Promise<Uint8Array> {
    if (this.pending) throw new Error("CMSIS-DAP 探针仍有未完成请求");
    if (payload.byteLength + 1 > this.packetSize) throw new Error("CMSIS-DAP 请求超过探针包长");
    const packet = new Uint8Array(this.packetSize);
    packet[0] = command;
    packet.set(payload, 1);
    let timer = 0;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      timer = window.setTimeout(() => { this.pending = null; reject(new Error("CMSIS-DAP 探针响应超时")); }, timeout);
      this.pending = { command, resolve, reject, timer };
    });
    try {
      await this.device.sendReport(this.reportId, packet);
      return await response;
    } catch (error) {
      window.clearTimeout(timer);
      this.pending = null;
      throw error;
    }
  }

  async close() {
    this.device.removeEventListener("inputreport", this.handleInput as EventListener);
    await this.device.close().catch(() => undefined);
  }
}

class CmsisDapUsbTransport implements CmsisDapPacketTransport {
  private packetSize = 64;

  constructor(private device: UsbDeviceLike) {}

  get probeName() { return this.device.productName || "CMSIS-DAP"; }
  get maxPacketSize() { return this.packetSize; }
  setMaxPacketSize(size: number) { this.packetSize = Math.max(64, size); }

  async exchange(command: number, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), timeout = 5000): Promise<Uint8Array> {
    if (payload.byteLength + 1 > this.packetSize) throw new Error("CMSIS-DAP 请求超过探针包长");
    const packet = new Uint8Array(this.packetSize);
    packet[0] = command;
    packet.set(payload, 1);
    let timer = 0;
    const transfer = (async () => {
      const write = await this.device.transferOut(1, packet);
      if (write.status && write.status !== "ok") throw new Error(`CMSIS-DAP USB 写入失败（${write.status}）`);
      const response = await this.device.transferIn(2, this.packetSize);
      if (response.status && response.status !== "ok") throw new Error(`CMSIS-DAP USB 读取失败（${response.status}）`);
      if (!response.data || response.data.byteLength === 0) throw new Error("CMSIS-DAP 探针返回了空响应");
      const bytes = Uint8Array.from(new Uint8Array(response.data.buffer, response.data.byteOffset, response.data.byteLength));
      if (bytes[0] !== command) throw new Error(`CMSIS-DAP 探针响应命令不匹配（收到 0x${(bytes[0] || 0).toString(16)}）`);
      return bytes;
    })();
    const expired = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("CMSIS-DAP 探针响应超时")), timeout);
    });
    try {
      return await Promise.race([transfer, expired]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async close() {
    await this.device.releaseInterface(0).catch(() => undefined);
    await this.device.close().catch(() => undefined);
  }
}

class CmsisDap {
  constructor(private transport: CmsisDapPacketTransport) {}

  get probeName() { return this.transport.probeName; }
  get maxPacketSize() { return this.transport.maxPacketSize; }

  async exchange(command: number, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), timeout = 5000) {
    return this.transport.exchange(command, payload, timeout);
  }

  async initialise() {
    const packetSize = await this.exchange(DAP_INFO, new Uint8Array([0xff]));
    if (packetSize[1] >= 2) this.transport.setMaxPacketSize(readU16(packetSize, 2));
    const connected = await this.exchange(DAP_CONNECT, new Uint8Array([1]));
    if (connected[1] !== 1) throw new Error("CMSIS-DAP 探针无法进入 SWD 模式");
    await this.expectOk(DAP_SWJ_CLOCK, u32(1_000_000));
    await this.expectOk(DAP_TRANSFER_CONFIGURE, new Uint8Array([0, 100, 0, 0, 0]));
    await this.expectOk(DAP_SWD_CONFIGURE, new Uint8Array([0]));
    const sequence = new Uint8Array([136, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x9e, 0xe7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
    await this.expectOk(DAP_SWJ_SEQUENCE, sequence);
  }

  async expectOk(command: number, payload: Uint8Array<ArrayBufferLike> = new Uint8Array()) {
    const response = await this.exchange(command, payload);
    if (response[1] !== 0) throw new Error(`CMSIS-DAP 命令 0x${command.toString(16)} 执行失败`);
  }

  async transfer(request: number, value?: number): Promise<number> {
    const payload = value === undefined ? new Uint8Array([0, 1, request]) : concat(new Uint8Array([0, 1, request]), u32(value));
    const response = await this.exchange(DAP_TRANSFER, payload);
    if (response[1] !== 1 || (response[2] & 7) !== 1) throw new Error(`SWD 传输失败（状态 0x${(response[2] || 0).toString(16)}）`);
    return value === undefined ? readU32(response, 3) : 0;
  }

  async transferBlock(request: number, valuesOrCount: number[] | number): Promise<number[]> {
    const write = Array.isArray(valuesOrCount);
    const count = write ? valuesOrCount.length : valuesOrCount;
    const header = new Uint8Array([0, count & 0xff, count >>> 8, request]);
    const payload = write ? concat(header, ...valuesOrCount.map(u32)) : header;
    const response = await this.exchange(DAP_TRANSFER_BLOCK, payload, 10_000);
    if (readU16(response, 1) !== count || (response[3] & 7) !== 1) throw new Error(`SWD 批量传输失败（状态 0x${(response[3] || 0).toString(16)}）`);
    if (write) return [];
    return Array.from({ length: count }, (_, index) => readU32(response, 4 + index * 4));
  }

  async disconnect() { await this.exchange(DAP_DISCONNECT).catch(() => undefined); }
  async resetTarget() { await this.exchange(DAP_RESET_TARGET).catch(() => undefined); }
  async close() { await this.transport.close(); }
}

class Stm32Swd {
  constructor(private dap: CmsisDap) {}

  async initialise() {
    await this.dap.initialise();
    await this.dap.transfer(0x00, 0x1e);
    await this.dap.transfer(DP_SELECT_WRITE, 0);
    await this.dap.transfer(DP_CTRL_STAT_WRITE, 0x50000000);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await this.dap.transfer(DP_CTRL_STAT_READ);
      if (((status & 0xa0000000) >>> 0) === 0xa0000000) return;
    }
    throw new Error("目标芯片 SWD 电源域未就绪");
  }

  async idcode(): Promise<number> { return this.dap.transfer(DP_IDCODE_READ); }

  private async setAccess(size: 0 | 1 | 2) {
    await this.dap.transfer(DP_SELECT_WRITE, 0);
    await this.dap.transfer(AP_CSW_WRITE, 0x23000050 | size);
  }

  async read32(address: number): Promise<number> {
    await this.setAccess(2);
    await this.dap.transfer(AP_TAR_WRITE, address);
    return this.dap.transfer(AP_DRW_READ);
  }

  async read16(address: number): Promise<number> {
    await this.setAccess(1);
    await this.dap.transfer(AP_TAR_WRITE, address);
    return (await this.dap.transfer(AP_DRW_READ)) & 0xffff;
  }

  async write32(address: number, value: number) {
    await this.setAccess(2);
    await this.dap.transfer(AP_TAR_WRITE, address);
    await this.dap.transfer(AP_DRW_WRITE, value);
  }

  async writeHalfwords(address: number, values: number[]) {
    await this.setAccess(1);
    let offset = 0;
    const maxWords = Math.max(1, Math.floor((this.dap.maxPacketSize - 5) / 4));
    while (offset < values.length) {
      const byteAddress = address + offset * 2;
      const boundaryWords = (1024 - (byteAddress & 1023)) / 2;
      const count = Math.min(maxWords, boundaryWords, values.length - offset);
      await this.dap.transfer(AP_TAR_WRITE, byteAddress);
      await this.dap.transferBlock(AP_DRW_WRITE, alignHalfwordTransferValues(byteAddress, values.slice(offset, offset + count)));
      offset += count;
    }
  }

  async readWords(address: number, count: number): Promise<number[]> {
    await this.setAccess(2);
    const values: number[] = [];
    const maxWords = Math.max(1, Math.floor((this.dap.maxPacketSize - 5) / 4));
    while (values.length < count) {
      const byteAddress = address + values.length * 4;
      const boundaryWords = (1024 - (byteAddress & 1023)) / 4;
      const batch = Math.min(maxWords, boundaryWords, count - values.length);
      await this.dap.transfer(AP_TAR_WRITE, byteAddress);
      values.push(...await this.dap.transferBlock(AP_DRW_READ, batch));
    }
    return values;
  }

  async waitFlash() {
    for (let attempt = 0; attempt < 20_000; attempt += 1) {
      const status = await this.read32(STM32_FLASH_SR);
      if ((status & 1) === 0) {
        if ((status & 0x14) !== 0) throw new Error(`STM32 Flash 控制器报告错误 0x${status.toString(16)}`);
        if ((status & 0x20) !== 0) await this.write32(STM32_FLASH_SR, 0x20);
        return;
      }
    }
    throw new Error("等待 STM32 Flash 操作完成超时");
  }
}

const SLOGIC_COMBO8_VENDOR_ID = 0xd6e7;
const SLOGIC_COMBO8_PRODUCT_ID = 0x3507;

async function openUsbProbe(device: UsbDeviceLike): Promise<CmsisDapPacketTransport> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  try {
    await device.claimInterface(0);
  } catch (error) {
    await device.close().catch(() => undefined);
    throw error;
  }
  return new CmsisDapUsbTransport(device);
}

async function openHidProbe(device: HidDeviceLike): Promise<CmsisDapPacketTransport> {
  if (!device.opened) await device.open();
  return new CmsisDapHidTransport(device);
}

async function requestProbe(): Promise<CmsisDapPacketTransport> {
  const usb = (navigator as UsbNavigatorLike).usb;
  const hid = (navigator as HidNavigatorLike).hid;

  if (usb) {
    const authorized = (await usb.getDevices()).find((device) => device.vendorId === SLOGIC_COMBO8_VENDOR_ID && device.productId === SLOGIC_COMBO8_PRODUCT_ID);
    if (authorized) return openUsbProbe(authorized);
  }
  if (hid?.getDevices) {
    const authorized = (await hid.getDevices()).find((device) => /cmsis.?dap|daplink/i.test(device.productName || ""));
    if (authorized) return openHidProbe(authorized);
  }
  if (usb) {
    try {
      const device = await usb.requestDevice({ filters: [{ vendorId: SLOGIC_COMBO8_VENDOR_ID, productId: SLOGIC_COMBO8_PRODUCT_ID }] });
      return await openUsbProbe(device);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
  if (!hid) throw new Error("当前浏览器不支持可用的 USB 调试探针连接方式");
  const devices = await hid.requestDevice({ filters: [] });
  const device = devices[0];
  if (!device) throw new Error("没有选择 CMSIS-DAP 调试探针");
  return openHidProbe(device);
}

export async function flashDotInitialFirmware(
  firmware: ParsedInitialFirmware,
  onProgress: (progress: SwdFlashProgress) => void,
): Promise<SwdFlashResult> {
  onProgress({ stage: "connecting", percent: 1, detail: "正在连接 CMSIS-DAP 探针" });
  const transport = await requestProbe();
  const dap = new CmsisDap(transport);
  const swd = new Stm32Swd(dap);
  try {
    await swd.initialise();
    onProgress({ stage: "checking", percent: 3, detail: "正在读取芯片型号和 Flash 容量" });
    const debugPortId = await swd.idcode();
    const deviceId = await swd.read32(STM32_DBGMCU_IDCODE);
    const flashKilobytes = await swd.read16(STM32_FLASH_SIZE_REGISTER);
    if (debugPortId === 0 || debugPortId === 0xffffffff) throw new Error("SWD 已连接，但没有读到有效调试端口");
    if ((deviceId & 0xfff) !== STM32F103_MEDIUM_DEVICE_ID || flashKilobytes !== 128) {
      throw new Error(`检测到 Device ID 0x${(deviceId & 0xfff).toString(16).toUpperCase()}、${flashKilobytes} KiB Flash；不是目标 STM32F103CB，未执行擦除`);
    }

    await swd.write32(CORTEX_DHCSR, 0xa05f0003);
    await swd.write32(STM32_RCC_CR, (await swd.read32(STM32_RCC_CR)) | 1);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await swd.read32(STM32_RCC_CR) & 2) !== 0) break;
      if (attempt === 99) throw new Error("STM32 内部时钟未就绪，未执行擦除");
    }
    const flashControl = await swd.read32(STM32_FLASH_CR);
    if ((flashControl & 0x80) !== 0) {
      await swd.write32(STM32_FLASH_KEYR, 0x45670123);
      await swd.write32(STM32_FLASH_KEYR, 0xcdef89ab);
    }
    if ((await swd.read32(STM32_FLASH_CR) & 0x80) !== 0) throw new Error("STM32 Flash 仍处于写保护状态");

    for (let page = 0; page < STM32_FLASH_SIZE / STM32_FLASH_PAGE_SIZE; page += 1) {
      onProgress({ stage: "erasing", percent: 5 + Math.round(page / 128 * 20), detail: `正在擦除 Flash · ${page + 1}/128` });
      await swd.write32(STM32_FLASH_CR, 0x02);
      await swd.write32(STM32_FLASH_AR, STM32_FLASH_BASE + page * STM32_FLASH_PAGE_SIZE);
      await swd.write32(STM32_FLASH_CR, 0x42);
      await swd.waitFlash();
    }

    await swd.write32(STM32_FLASH_CR, 0x01);
    const halfwordCount = firmware.image.byteLength / 2;
    for (let offset = 0; offset < halfwordCount;) {
      const value = firmware.image[offset * 2] | firmware.image[offset * 2 + 1] << 8;
      if (value === 0xffff) { offset += 1; continue; }
      const start = offset;
      const values: number[] = [];
      while (offset < halfwordCount && values.length < 256) {
        const next = firmware.image[offset * 2] | firmware.image[offset * 2 + 1] << 8;
        if (next === 0xffff) break;
        values.push(next);
        offset += 1;
      }
      await swd.writeHalfwords(STM32_FLASH_BASE + start * 2, values);
      await swd.waitFlash();
      onProgress({ stage: "writing", percent: 25 + Math.round(offset / halfwordCount * 50), detail: `正在写入初始固件 · ${Math.min(100, Math.round(offset / halfwordCount * 100))}%` });
    }
    await swd.write32(STM32_FLASH_CR, 0x80);

    const wordCount = firmware.image.byteLength / 4;
    const verifyBatch = 256;
    for (let offset = 0; offset < wordCount; offset += verifyBatch) {
      const count = Math.min(verifyBatch, wordCount - offset);
      const actual = await swd.readWords(STM32_FLASH_BASE + offset * 4, count);
      for (let index = 0; index < count; index += 1) {
        if (actual[index] !== readU32(firmware.image, (offset + index) * 4)) {
          throw new Error(`初始固件回读校验失败，地址 0x${(STM32_FLASH_BASE + (offset + index) * 4).toString(16).toUpperCase()}`);
        }
      }
      onProgress({ stage: "verifying", percent: 75 + Math.round((offset + count) / wordCount * 23), detail: `正在回读校验 · ${Math.round((offset + count) / wordCount * 100)}%` });
    }

    onProgress({ stage: "restarting", percent: 99, detail: "校验通过，正在重启小车" });
    await swd.write32(CORTEX_DHCSR, 0xa05f0001);
    await swd.write32(CORTEX_AIRCR, 0x05fa0004).catch(() => undefined);
    await dap.resetTarget();
    onProgress({ stage: "restarting", percent: 100, detail: "初始固件已写入" });
    return { probeName: dap.probeName, deviceId, flashSize: flashKilobytes * 1024, programmedBytes: firmware.programmedBytes };
  } finally {
    await dap.disconnect();
    await dap.close();
  }
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { alignHalfwordTransferValues, flashDotInitialFirmware, parseDotInitialHex, requestCmsisDapProbe } from "../src/cmsis-dap-swd.js";

Object.assign(globalThis, { window: globalThis });

test("places halfword writes in the MEM-AP byte lane selected by the address", () => {
  assert.deepEqual(alignHalfwordTransferValues(0x08000000, [0x1234, 0xabcd, 0x5678]), [0x1234, 0xabcd0000, 0x5678]);
  assert.deepEqual(alignHalfwordTransferValues(0x08000002, [0x1234, 0xabcd]), [0x12340000, 0xabcd]);
});

class WrongTargetProbe extends EventTarget {
  opened = false;
  productName = "CMSIS-DAP test probe";
  collections = [{ outputReports: [{ reportId: 0 }] }];
  targetWrites: number[] = [];
  private tar = 0;

  async open() { this.opened = true; }
  async close() { this.opened = false; }

  async sendReport(_reportId: number, data: BufferSource) {
    const packet = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const response = new Uint8Array(64);
    response[0] = packet[0];
    if (packet[0] === 0x00) { response[1] = 2; response[2] = 64; }
    else if (packet[0] === 0x02) response[1] = 1;
    else if ([0x04, 0x11, 0x12, 0x13].includes(packet[0])) response[1] = 0;
    else if (packet[0] === 0x05) {
      const request = packet[3];
      const write = (request & 2) === 0;
      const value = new DataView(packet.buffer, packet.byteOffset).getUint32(4, true);
      response[1] = 1; response[2] = 1;
      if (write && request === 0x05) this.tar = value;
      if (write && request === 0x0d) this.targetWrites.push(this.tar);
      let read = 0;
      if (!write && request === 0x06) read = 0xa0000000;
      else if (!write && request === 0x02) read = 0x2ba01477;
      else if (!write && request === 0x0f && this.tar === 0xe0042000) read = 0x411;
      else if (!write && request === 0x0f && this.tar === 0x1ffff7e0) read = 64;
      new DataView(response.buffer).setUint32(3, read, true);
    }
    queueMicrotask(() => {
      const event = new Event("inputreport") as Event & { data: DataView };
      Object.defineProperty(event, "data", { value: new DataView(response.buffer) });
      this.dispatchEvent(event);
    });
  }
}

test("checks SWD chip identity before any target flash write", async () => {
  const probe = new WrongTargetProbe();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hid: { async requestDevice() { return [probe]; } } },
  });
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  await assert.rejects(() => flashDotInitialFirmware(firmware, () => undefined), /不是支持的 DOT STM32F103/);
  assert.deepEqual(probe.targetWrites, []);
});

class WrongTargetUsbProbe {
  opened = false;
  vendorId = 0xd6e7;
  productId = 0x3507;
  productName = "SLogic Combo8";
  configuration: { configurationValue: number } | null = null;
  claimedInterfaces: number[] = [];
  releasedInterfaces: number[] = [];
  targetWrites: number[] = [];
  swdClocks: number[] = [];
  transferRequests: number[] = [];
  private packet = new Uint8Array();
  private tar = 0;

  constructor(private transferStatus: number | (() => number) = 1) {}

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async selectConfiguration(configurationValue: number) { this.configuration = { configurationValue }; }
  async claimInterface(interfaceNumber: number) { this.claimedInterfaces.push(interfaceNumber); }
  async releaseInterface(interfaceNumber: number) { this.releasedInterfaces.push(interfaceNumber); }
  async transferOut(endpointNumber: number, data: BufferSource) {
    assert.equal(endpointNumber, 1);
    this.packet = data instanceof ArrayBuffer
      ? new Uint8Array(data).slice()
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    if (this.packet[0] === 0x11) this.swdClocks.push(new DataView(this.packet.buffer, this.packet.byteOffset).getUint32(1, true));
    if (this.packet[0] === 0x05) this.transferRequests.push(this.packet[3]);
    return { status: "ok" };
  }
  async transferIn(endpointNumber: number, length: number) {
    assert.equal(endpointNumber, 2);
    const response = new Uint8Array(length);
    response[0] = this.packet[0];
    if (this.packet[0] === 0x00) { response[1] = 2; response[2] = 64; }
    else if (this.packet[0] === 0x02) response[1] = 1;
    else if ([0x04, 0x11, 0x12, 0x13].includes(this.packet[0])) response[1] = 0;
    else if (this.packet[0] === 0x05) {
      const request = this.packet[3];
      const write = (request & 2) === 0;
      const value = new DataView(this.packet.buffer, this.packet.byteOffset).getUint32(4, true);
      const transferStatus = typeof this.transferStatus === "function" ? this.transferStatus() : this.transferStatus;
      response[1] = transferStatus === 1 ? 1 : 0; response[2] = transferStatus;
      if (transferStatus !== 1) return { data: new DataView(response.buffer), status: "ok" };
      if (write && request === 0x05) this.tar = value;
      if (write && request === 0x0d) this.targetWrites.push(this.tar);
      let read = 0;
      if (!write && request === 0x06) read = 0xa0000000;
      else if (!write && request === 0x02) read = 0x2ba01477;
      else if (!write && request === 0x0f && this.tar === 0xe0042000) read = 0x411;
      else if (!write && request === 0x0f && this.tar === 0x1ffff7e0) read = 64;
      new DataView(response.buffer).setUint32(3, read, true);
    }
    return { data: new DataView(response.buffer), status: "ok" };
  }
}

test("uses CMSIS-DAP v2 bulk endpoints for SLogic Combo8 and keeps the chip guard", async () => {
  const probe = new WrongTargetUsbProbe();
  let requestedOptions: unknown;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      usb: {
        async getDevices() { return []; },
        async requestDevice(options: unknown) { requestedOptions = options; return probe; },
      },
    },
  });
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  await assert.rejects(() => flashDotInitialFirmware(firmware, () => undefined), /不是支持的 DOT STM32F103/);
  assert.deepEqual(requestedOptions, { filters: [{ vendorId: 0xd6e7, productId: 0x3507 }] });
  assert.deepEqual(probe.claimedInterfaces, [0]);
  assert.deepEqual(probe.releasedInterfaces, [0]);
  assert.equal(probe.transferRequests[0], 0x02);
  assert.deepEqual(probe.targetWrites, []);
  assert.equal(probe.opened, false);
});

test("falls back to WebHID when no SLogic USB probe is selected", async () => {
  const probe = new WrongTargetProbe();
  let hidRequested = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      usb: {
        async getDevices() { return []; },
        async requestDevice() { throw new DOMException("No device selected", "NotFoundError"); },
      },
      hid: {
        async getDevices() { return []; },
        async requestDevice() { hidRequested = true; return [probe]; },
      },
    },
  });
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  await assert.rejects(() => flashDotInitialFirmware(firmware, () => undefined), /不是支持的 DOT STM32F103/);
  assert.equal(hidRequested, true);
  assert.deepEqual(probe.targetWrites, []);
});

test("opens the WebHID chooser directly for a user-selected DAPLink", async () => {
  const probe = new WrongTargetProbe();
  let hidRequested = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      usb: {
        async getDevices() { throw new Error("must not inspect or prompt USB before WebHID"); },
        async requestDevice() { throw new Error("must not prompt USB before WebHID"); },
      },
      hid: {
        async requestDevice(options: unknown) {
          hidRequested = true;
          assert.deepEqual(options, { filters: [] });
          return [probe];
        },
      },
    },
  });
  const transport = await requestCmsisDapProbe("hid");
  assert.equal(hidRequested, true);
  assert.equal(probe.opened, true);
  await transport.close();
  assert.equal(probe.opened, false);
});

test("opens only the filtered WebUSB chooser for an explicitly selected SLogic Combo8", async () => {
  const probe = new WrongTargetUsbProbe();
  let requestedOptions: unknown;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      usb: {
        async requestDevice(options: unknown) { requestedOptions = options; return probe; },
      },
      hid: {
        async requestDevice() { throw new Error("must not prompt WebHID for Combo8"); },
      },
    },
  });
  const transport = await requestCmsisDapProbe("slogic-combo8");
  assert.deepEqual(requestedOptions, { filters: [{ vendorId: 0xd6e7, productId: 0x3507 }] });
  assert.equal(probe.claimedInterfaces.length, 1);
  await transport.close();
  assert.equal(probe.opened, false);
});

test("retries an unresponsive SWD target at lower clocks and reports wiring guidance", async () => {
  const probe = new WrongTargetUsbProbe(0x07);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      usb: {
        async getDevices() { return [probe]; },
        async requestDevice() { throw new Error("authorized probe should be reused"); },
      },
    },
  });
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  await assert.rejects(
    () => flashDotInitialFirmware(firmware, () => undefined),
    /目标芯片没有回应 SWD.*GND 共地.*TMS 接 SDIO\/SWDIO.*TCK 接 SCLK\/SWCLK/,
  );
  assert.deepEqual(probe.swdClocks, [1_000_000, 250_000, 50_000]);
  assert.deepEqual(probe.targetWrites, []);
});

test("keeps one probe session open while the user connects under reset", async () => {
  let transfers = 0;
  const probe = new WrongTargetUsbProbe(() => ++transfers <= 3 ? 0x07 : 1);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { usb: { async getDevices() { return [probe]; }, async requestDevice() { throw new Error("authorized probe should be reused"); } } },
  });
  const actions: string[] = [];
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  await assert.rejects(
    () => flashDotInitialFirmware(firmware, () => undefined, {
      async holdReset() { actions.push("hold"); },
      async releaseReset(targetDetected) { actions.push(targetDetected ? "release-detected" : "release-failed"); },
    }),
    /不是支持的 DOT STM32F103/,
  );
  assert.deepEqual(actions, ["hold", "release-detected"]);
  assert.equal(probe.claimedInterfaces.length, 1);
  assert.deepEqual(probe.swdClocks, [1_000_000, 250_000, 50_000, 1_000_000]);
  assert.deepEqual(probe.targetWrites, []);
});

test("validates the 64 KiB compact initial firmware layout", () => {
  const firmware = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_compact_initial_swd.hex", "utf8"), 64);
  assert.equal(firmware.flashSize, 64 * 1024);
  assert.equal(firmware.applicationBase, 0x08001000);
  assert.equal(firmware.applicationLimit, 0x0800fc00);
  assert.ok(firmware.programmedBytes < 64 * 1024);
});

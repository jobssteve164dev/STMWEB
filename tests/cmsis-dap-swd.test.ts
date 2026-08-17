import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { alignHalfwordTransferValues, flashDotInitialFirmware, parseDotInitialHex } from "../src/cmsis-dap-swd.js";

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
  await assert.rejects(() => flashDotInitialFirmware(firmware, () => undefined), /不是目标 STM32F103CB/);
  assert.deepEqual(probe.targetWrites, []);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDotInitialHex } from "../src/cmsis-dap-swd.js";
import { crc32, DotBootResponseDecoder, encodeBootFrame, flashDotApplication, validateDotApplication } from "../src/dot-firmware-flasher.js";
import type { HardwareConnection } from "../src/hardware.js";

Object.assign(globalThis, { window: globalThis });

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function helloPayload(): Uint8Array {
  const result = new Uint8Array(20);
  result.set(u32(128 * 1024), 0);
  result.set(u32(0x08004000), 4);
  result.set(u32(0x1bc00), 8);
  result.set(u32(1), 12);
  result.set(u32(0x20000410), 16);
  return result;
}

function application(size = 300): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(u32(0x20005000), 0);
  bytes.set(u32(0x08004101), 4);
  for (let index = 8; index < bytes.length; index += 1) bytes[index] = index & 0xff;
  return bytes;
}

test("validates the generated DOT initial SWD Intel HEX", () => {
  const parsed = parseDotInitialHex(readFileSync("public/firmware/dot-v1/dot_v1_initial_swd.hex", "utf8"));
  assert.equal(parsed.image.byteLength, 128 * 1024);
  assert.ok(parsed.programmedBytes > 90_000);
});

test("rejects an application linked at the original flash base", () => {
  const bytes = application();
  bytes.set(u32(0x08000101), 4);
  assert.throws(() => validateDotApplication(bytes), /0x08004000/);
});

test("decodes a fragmented bootloader response after unrelated bytes", () => {
  const decoder = new DotBootResponseDecoder();
  const frame = encodeBootFrame(0x81, 7, 0, helloPayload());
  assert.deepEqual(decoder.push(new Uint8Array([1, 2, 3, ...frame.subarray(0, 5)])), []);
  const responses = decoder.push(frame.subarray(5));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].sequence, 7);
  assert.deepEqual(responses[0].payload, helloPayload());
});

test("flashes a relocated DOT application through the Bluetooth boot protocol", async () => {
  const firmware = application();
  const requestDecoder = new DotBootResponseDecoder();
  let rawHandler: ((bytes: Uint8Array) => void) | null = null;
  let entered = false;
  let expectedSize = 0;
  let expectedCrc = 0;
  const received: number[] = [];
  const connection: HardwareConnection = {
    kind: "bluetooth",
    name: "ECB02",
    detail: "test",
    setDataHandler(handler) { rawHandler = handler; },
    async write(data) {
      if (typeof data === "string") { entered = data === "STMWEB:BOOT"; return; }
      for (const request of requestDecoder.push(data)) {
        let payload = new Uint8Array();
        if (request.command === 1) payload = helloPayload();
        if (request.command === 2) {
          expectedSize = new DataView(request.payload.buffer, request.payload.byteOffset).getUint32(0, true);
          expectedCrc = new DataView(request.payload.buffer, request.payload.byteOffset).getUint32(4, true);
        }
        if (request.command === 3) received.push(...request.payload);
        const response = encodeBootFrame(request.command | 0x80, request.sequence, 0, payload);
        rawHandler?.(response.subarray(0, 7));
        rawHandler?.(response.subarray(7));
        if (request.command === 4) setTimeout(() => rawHandler?.(new TextEncoder().encode("bat3.90")), 20);
      }
    },
    async close() {},
  };
  const progress: number[] = [];
  const result = await flashDotApplication(connection, firmware, (value) => progress.push(value.percent));
  assert.equal(entered, true);
  assert.equal(expectedSize, firmware.byteLength);
  assert.equal(expectedCrc, crc32(firmware));
  assert.deepEqual(received, [...firmware]);
  assert.equal(result.restartConfirmed, true);
  assert.equal(progress.at(-1), 100);
});

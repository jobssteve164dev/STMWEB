import assert from "node:assert/strict";
import test from "node:test";
import { flashCardputerAdvApplication, validateCardputerAdvApplication } from "../src/cardputer-adv-flasher.js";
import type { HardwareConnection } from "../src/hardware.js";

function applicationFixture(size = 900): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xe9, 3, 2, 0, 0, 0, 0, 0]);
  bytes.set(new TextEncoder().encode("STMWEB_ADAPTER:stmweb.cardputer-adv"), 64);
  for (let index = 128; index < bytes.length; index++) bytes[index] = index & 0xff;
  return bytes;
}

test("rejects a non-Cardputer ESP32 application before contacting the device", () => {
  assert.throws(() => validateCardputerAdvApplication(new Uint8Array([0xe9, 0, 0, 0])), /Cardputer ADV/);
});

test("streams a Cardputer ADV image over BLE OTA and confirms the verified restart schedule", async () => {
  const writes: Uint8Array[] = [];
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const connection: HardwareConnection = {
    kind: "bluetooth", name: "STMWEB Cardputer ADV", detail: "connected",
    setDataHandler(next) { handler = next; },
    async write(value) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
      writes.push(bytes);
      const opcode = bytes[0];
      const offset = opcode === 0xa1 ? new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(0, true) + bytes.byteLength - 5 : 0;
      queueMicrotask(() => handler?.(Uint8Array.from([0xb0, 0, opcode, offset & 0xff, offset >>> 8 & 0xff, offset >>> 16 & 0xff, offset >>> 24 & 0xff])));
      if (opcode === 0xa2) queueMicrotask(() => handler?.(new TextEncoder().encode("STMWEB_READY:stmweb.cardputer-adv:1\n")));
    },
    async close() {},
  };
  const progress: number[] = [];
  const result = await flashCardputerAdvApplication(connection, applicationFixture(), (state) => progress.push(state.percent));
  assert.equal(writes[0][0], 0xa0);
  assert.equal(writes.at(-1)?.[0], 0xa2);
  assert.equal(writes.filter((packet) => packet[0] === 0xa1).length > 1, true);
  assert.equal(progress.at(-1), 100);
  assert.equal(result.restartScheduled, true);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("reports a device write rejection immediately even when it acknowledges the previous offset", async () => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const connection: HardwareConnection = {
    kind: "bluetooth", name: "STMWEB Cardputer ADV", detail: "connected",
    setDataHandler(next) { handler = next; },
    async write(value) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
      const opcode = bytes[0];
      const status = opcode === 0xa1 ? 1 : 0;
      queueMicrotask(() => handler?.(Uint8Array.from([0xb0, status, opcode, 0, 0, 0, 0])));
    },
    async close() {},
  };
  await assert.rejects(() => flashCardputerAdvApplication(connection, applicationFixture(256), () => undefined), /拒绝了升级数据/);
});

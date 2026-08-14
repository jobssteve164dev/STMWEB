import assert from "node:assert/strict";
import test from "node:test";
import { requestHardwareConnection } from "../src/hardware.js";

class MockCharacteristic extends EventTarget {
  value?: DataView;
  notificationsStarted = false;
  notificationsStopped = false;
  writes: Uint8Array[] = [];

  async startNotifications() {
    this.notificationsStarted = true;
    return this;
  }

  async stopNotifications() {
    this.notificationsStopped = true;
    return this;
  }

  async writeValueWithoutResponse(value: BufferSource) {
    const view = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.writes.push(Uint8Array.from(view));
  }
}

test("connects the ECB02 GATT data channel and forwards notifications", async () => {
  const notify = new MockCharacteristic();
  const write = new MockCharacteristic();
  let requestedOptions: unknown;
  let disconnected = false;
  const bluetooth = {
    async requestDevice(options: unknown) {
      requestedOptions = options;
      return {
        id: "ecb02-test",
        name: "ECB02",
        gatt: {
          connected: false,
          async connect() {
            return {
              connected: true,
              disconnect() { disconnected = true; },
              async getPrimaryService(uuid: number) {
                assert.equal(uuid, 0xfff0);
                return {
                  async getCharacteristic(characteristicUuid: number) {
                    if (characteristicUuid === 0xfff1) return notify;
                    if (characteristicUuid === 0xfff2) return write;
                    throw new Error("unexpected characteristic");
                  },
                };
              },
            };
          },
          disconnect() { disconnected = true; },
        },
      };
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { bluetooth },
  });

  const received: string[] = [];
  const connection = await requestHardwareConnection("bluetooth", {
    onSerialText: (text) => received.push(text),
  });

  assert.deepEqual(requestedOptions, { acceptAllDevices: true, optionalServices: [0xfff0] });
  assert.equal(connection.detail, "蓝牙数据通道已连接");
  assert.equal(notify.notificationsStarted, true);

  const payload = new TextEncoder().encode("STMWEB_CAPS:{}\r\n");
  notify.value = new DataView(payload.buffer);
  notify.dispatchEvent(new Event("characteristicvaluechanged"));
  assert.deepEqual(received, ["STMWEB_CAPS:{}\r\n"]);

  await connection.write?.("go");
  assert.deepEqual(Array.from(write.writes[0]), [103, 111]);
  await connection.close();
  assert.equal(notify.notificationsStopped, true);
  assert.equal(disconnected, true);
});

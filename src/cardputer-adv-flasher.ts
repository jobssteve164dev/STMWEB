import type { HardwareConnection } from "./hardware.js";

export interface CardputerAdvFlashProgress { stage: "checking" | "writing" | "verifying" | "restarting"; percent: number }

interface PendingAcknowledgement {
  opcode: number;
  offset: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const adapterMarker = new TextEncoder().encode("STMWEB_ADAPTER:stmweb.cardputer-adv");

function contains(source: Uint8Array, expected: Uint8Array): boolean {
  outer: for (let start = 0; start <= source.byteLength - expected.byteLength; start++) {
    for (let index = 0; index < expected.byteLength; index++) if (source[start + index] !== expected[index]) continue outer;
    return true;
  }
  return false;
}

export function validateCardputerAdvApplication(firmware: Uint8Array): void {
  if (firmware.byteLength < 128 || firmware[0] !== 0xe9 || !contains(firmware, adapterMarker)) {
    throw new Error("不是可验证的 Cardputer ADV 应用固件");
  }
}

export async function flashCardputerAdvApplication(
  connection: HardwareConnection,
  firmware: Uint8Array,
  onProgress: (progress: CardputerAdvFlashProgress) => void,
): Promise<{ sha256: string; restartScheduled: boolean }> {
  validateCardputerAdvApplication(firmware);
  if (connection.kind !== "bluetooth" || !connection.write || !connection.setDataHandler) throw new Error("请先通过蓝牙连接 Cardputer ADV");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(firmware).buffer));
  const sha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  let pending: PendingAcknowledgement | null = null;
  let ready = false;
  let readyResolve: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });
  connection.setDataHandler((bytes) => {
    if (bytes[0] === 0xb0 && bytes.byteLength >= 7 && pending) {
      const status = bytes[1];
      const opcode = bytes[2];
      const offset = new DataView(bytes.buffer, bytes.byteOffset + 3, 4).getUint32(0, true);
      if (opcode !== pending.opcode) return;
      if (status === 0 && offset !== pending.offset) return;
      clearTimeout(pending.timer);
      const current = pending;
      pending = null;
      if (status === 0) current.resolve();
      else current.reject(new Error(`Cardputer ADV 拒绝了升级数据（状态 ${status}）`));
      return;
    }
    const text = new TextDecoder().decode(bytes);
    if (text.includes("STMWEB_READY:stmweb.cardputer-adv:")) { ready = true; readyResolve?.(); }
  });

  const send = async (packet: Uint8Array, opcode: number, offset: number) => {
    const acknowledgement = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.opcode === opcode && pending.offset === offset) pending = null;
        reject(new Error("Cardputer ADV 蓝牙升级响应中断"));
      }, 15_000);
      pending = { opcode, offset, resolve, reject, timer };
    });
    await connection.write!(packet);
    await acknowledgement;
  };

  try {
    onProgress({ stage: "checking", percent: 2 });
    const begin = new Uint8Array(37);
    begin[0] = 0xa0;
    new DataView(begin.buffer).setUint32(1, firmware.byteLength, true);
    begin.set(digest, 5);
    await send(begin, 0xa0, 0);
    const chunkSize = 180;
    for (let offset = 0; offset < firmware.byteLength; offset += chunkSize) {
      const data = firmware.subarray(offset, Math.min(offset + chunkSize, firmware.byteLength));
      const packet = new Uint8Array(5 + data.byteLength);
      packet[0] = 0xa1;
      new DataView(packet.buffer).setUint32(1, offset, true);
      packet.set(data, 5);
      const nextOffset = offset + data.byteLength;
      await send(packet, 0xa1, nextOffset);
      onProgress({ stage: "writing", percent: 5 + Math.floor(nextOffset / firmware.byteLength * 85) });
    }
    onProgress({ stage: "verifying", percent: 92 });
    await send(Uint8Array.of(0xa2), 0xa2, 0);
    onProgress({ stage: "restarting", percent: 97 });
    if (!ready) await Promise.race([readyPromise, new Promise<void>((resolve) => setTimeout(resolve, 8_000))]);
    onProgress({ stage: "restarting", percent: 100 });
    return { sha256, restartScheduled: ready };
  } finally {
    const outstanding = pending as PendingAcknowledgement | null;
    if (outstanding) clearTimeout(outstanding.timer);
    connection.setDataHandler(null);
  }
}

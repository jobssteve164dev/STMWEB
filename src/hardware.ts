export type HardwareCapabilityId = "serial" | "usb" | "hid" | "bluetooth" | "network";

export interface HardwareCapability {
  id: HardwareCapabilityId;
  label: string;
  description: string;
  supported: boolean;
  permission: string;
}

export interface HardwareConnection {
  kind: HardwareCapabilityId;
  name: string;
  detail: string;
  write?: (data: Uint8Array | string) => Promise<void>;
  close: () => Promise<void>;
}

export interface SerialConnectionOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  flowControl: "none" | "hardware";
}

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  open(options: SerialConnectionOptions): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

interface UsbDeviceLike {
  productName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface HidDeviceLike {
  productName?: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface BluetoothDeviceLike {
  name?: string;
  id: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothServerLike>;
    disconnect(): void;
  };
}

interface BluetoothCharacteristicLike extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BluetoothCharacteristicLike>;
  stopNotifications?(): Promise<BluetoothCharacteristicLike>;
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
}

interface BluetoothServiceLike {
  getCharacteristic(characteristic: string | number): Promise<BluetoothCharacteristicLike>;
}

interface BluetoothServerLike {
  connected: boolean;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothServiceLike>;
}

interface HardwareNavigator extends Navigator {
  serial?: {
    requestPort(): Promise<SerialPortLike>;
  };
  usb?: {
    requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<UsbDeviceLike>;
  };
  hid?: {
    requestDevice(options: { filters: Array<Record<string, number>> }): Promise<HidDeviceLike[]>;
  };
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices: boolean;
      optionalServices: Array<string | number>;
    }): Promise<BluetoothDeviceLike>;
  };
}

const ECB02_GATT = {
  service: 0xfff0,
  notify: 0xfff1,
  write: 0xfff2,
} as const;

const capabilityDefinitions: Array<Omit<HardwareCapability, "supported" | "permission">> = [
  {
    id: "serial",
    label: "串口",
    description: "选择端口并设置串口参数",
  },
  {
    id: "usb",
    label: "USB",
    description: "识别并授权 STM32 USB 设备",
  },
  {
    id: "hid",
    label: "调试探针",
    description: "识别并授权 HID 调试探针",
  },
  {
    id: "bluetooth",
    label: "蓝牙",
    description: "BLE GATT 与设备配网",
  },
  {
    id: "network",
    label: "Wi-Fi / 局域网",
    description: "通过设备地址访问 HTTP 接口",
  },
];

async function inspectLocalNetworkPermission(): Promise<string> {
  if (!("permissions" in navigator)) {
    return "连接时检查";
  }

  try {
    const query = navigator.permissions.query.bind(navigator.permissions) as unknown as (
      descriptor: { name: string },
    ) => Promise<PermissionStatus>;
    const status = await query({ name: "local-network" });
    if (status.state === "granted") return "已允许";
    if (status.state === "denied") return "已阻止";
    return "连接时询问";
  } catch {
    return "连接时检查";
  }
}

export async function inspectHardwareCapabilities(): Promise<HardwareCapability[]> {
  const hardwareNavigator = navigator as HardwareNavigator;
  const localNetworkPermission = await inspectLocalNetworkPermission();

  return capabilityDefinitions.map((definition) => {
    const supported =
      definition.id === "network"
        ? typeof fetch === "function"
        : definition.id in hardwareNavigator && Boolean(hardwareNavigator[definition.id]);

    return {
      ...definition,
      supported,
      permission:
        definition.id === "network"
          ? localNetworkPermission
          : supported
            ? "使用时授权"
            : "当前浏览器不可用",
    };
  });
}

function hexadecimal(value?: number): string {
  return value === undefined ? "未知" : `0x${value.toString(16).padStart(4, "0").toUpperCase()}`;
}

export async function requestHardwareConnection(
  kind: HardwareCapabilityId,
  options: {
    networkUrl?: string;
    serial?: SerialConnectionOptions;
    onSerialText?: (text: string) => void;
  } = {},
): Promise<HardwareConnection> {
  const hardwareNavigator = navigator as HardwareNavigator;

  if (kind === "serial") {
    if (!hardwareNavigator.serial) throw new Error("当前浏览器不支持串口访问");
    const port = await hardwareNavigator.serial.requestPort();
    const serial = options.serial ?? {
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    };
    await port.open(serial);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let closed = false;

    if (port.readable && options.onSerialText) {
      reader = port.readable.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          while (!closed) {
            const { value, done } = await reader!.read();
            if (done) break;
            if (value) options.onSerialText?.(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (!closed) {
            options.onSerialText?.(`\n[串口读取中断] ${error instanceof Error ? error.message : "未知错误"}`);
          }
        } finally {
          reader?.releaseLock();
        }
      })();
    }

    const info = port.getInfo?.() ?? {};
    return {
      kind,
      name: "串口设备",
      detail: `VID ${hexadecimal(info.usbVendorId)} · PID ${hexadecimal(info.usbProductId)} · ${serial.baudRate} baud · ${serial.dataBits}${serial.parity === "none" ? "N" : serial.parity === "even" ? "E" : "O"}${serial.stopBits}${serial.flowControl === "hardware" ? " · 硬件流控" : ""}`,
      close: async () => {
        closed = true;
        await reader?.cancel().catch(() => undefined);
        await port.close().catch(() => undefined);
      },
    };
  }

  if (kind === "usb") {
    if (!hardwareNavigator.usb) throw new Error("当前浏览器不支持 USB 设备访问");
    const device = await hardwareNavigator.usb.requestDevice({
      filters: [{ vendorId: 0x0483 }, { vendorId: 0x0d28 }],
    });
    if (!device.opened) await device.open();
    return {
      kind,
      name: device.productName || "STM32 USB 设备",
      detail: `VID ${hexadecimal(device.vendorId)} · PID ${hexadecimal(device.productId)}${device.serialNumber ? ` · ${device.serialNumber}` : ""}`,
      close: () => device.close(),
    };
  }

  if (kind === "hid") {
    if (!hardwareNavigator.hid) throw new Error("当前浏览器不支持 HID 设备访问");
    const devices = await hardwareNavigator.hid.requestDevice({ filters: [] });
    const device = devices[0];
    if (!device) throw new Error("没有选择调试探针");
    if (!device.opened) await device.open();
    return {
      kind,
      name: device.productName || "HID 调试探针",
      detail: `VID ${hexadecimal(device.vendorId)} · PID ${hexadecimal(device.productId)}`,
      close: () => device.close(),
    };
  }

  if (kind === "bluetooth") {
    if (!hardwareNavigator.bluetooth) throw new Error("当前浏览器不支持蓝牙访问");
    const device = await hardwareNavigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [ECB02_GATT.service],
    });
    if (!device.gatt) throw new Error("所选设备没有可用的 BLE GATT 服务");

    let server: BluetoothServerLike | undefined;
    let notifyCharacteristic: BluetoothCharacteristicLike | undefined;
    let handleNotification: ((event: Event) => void) | undefined;
    try {
      server = await device.gatt.connect();
      const service = await server.getPrimaryService(ECB02_GATT.service);
      notifyCharacteristic = await service.getCharacteristic(ECB02_GATT.notify);
      const writeCharacteristic = await service.getCharacteristic(ECB02_GATT.write);

      handleNotification = (event: Event) => {
        const value = (event.target as BluetoothCharacteristicLike | null)?.value;
        if (!value || !options.onSerialText) return;
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        options.onSerialText(new TextDecoder().decode(bytes));
      };
      notifyCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);
      await notifyCharacteristic.startNotifications();

      return {
        kind,
        name: device.name || "ECB02 蓝牙设备",
        detail: "蓝牙数据通道已连接",
        write: async (data) => {
          const bytes = typeof data === "string"
            ? new TextEncoder().encode(data)
            : Uint8Array.from(data);
          if (writeCharacteristic.writeValueWithoutResponse) {
            await writeCharacteristic.writeValueWithoutResponse(bytes);
            return;
          }
          if (writeCharacteristic.writeValue) {
            await writeCharacteristic.writeValue(bytes);
            return;
          }
          throw new Error("小车蓝牙写入通道不可用");
        },
        close: async () => {
          if (handleNotification) {
            notifyCharacteristic?.removeEventListener("characteristicvaluechanged", handleNotification);
          }
          await notifyCharacteristic?.stopNotifications?.().catch(() => undefined);
          server?.disconnect();
          device.gatt?.disconnect();
        },
      };
    } catch (error) {
      server?.disconnect();
      device.gatt.disconnect();
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error("所选设备没有 ECB02 默认蓝牙通道，请确认小车蓝牙已开启且模块 UUID 为 FFF0/FFF1/FFF2");
      }
      throw error;
    }
  }

  const urlText = options.networkUrl?.trim();
  if (!urlText) throw new Error("请输入设备的局域网地址");
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("设备地址必须使用 HTTP 或 HTTPS");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      url,
      {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
        targetAddressSpace: "local",
      } as RequestInit,
    );
    if (!response.ok) throw new Error(`设备返回 ${response.status}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("连接设备超时，请检查地址和设备网络状态");
    }
    if (error instanceof Error && error.message.startsWith("设备返回")) throw error;
    throw new Error("无法访问设备；请确认地址、局域网权限和设备 CORS 配置");
  } finally {
    window.clearTimeout(timeout);
  }

  return {
    kind,
    name: url.hostname,
    detail: `已验证 ${url.origin}`,
    close: async () => undefined,
  };
}

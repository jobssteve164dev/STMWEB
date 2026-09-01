import type { DebugEventRecord, FirmwareVersionRecord } from "./db.js";
import { DotFirmwareFlashPanel } from "./DotFirmwareFlashPanel.js";
import type { HardwareConnection } from "./hardware.js";
import { SwdFlashPanel } from "./InitialSwdFlashPanel.js";
import { UsbFirmwareFlashPanel } from "./UsbFirmwareFlashPanel.js";

interface Props {
  connection: HardwareConnection | null;
  voltage: number;
  firmwareVersions: FirmwareVersionRecord[];
  onEvent: (level: DebugEventRecord["level"], message: string, payload?: DebugEventRecord["payload"]) => void;
}

export function FirmwareFlashPanels(props: Props) {
  return <>
    <SwdFlashPanel firmwareVersions={props.firmwareVersions} />
    <UsbFirmwareFlashPanel firmwareVersions={props.firmwareVersions} onEvent={props.onEvent} />
    <DotFirmwareFlashPanel connection={props.connection} voltage={props.voltage} firmwareVersions={props.firmwareVersions} onEvent={props.onEvent} />
  </>;
}

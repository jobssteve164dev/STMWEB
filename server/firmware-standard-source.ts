const cardputerStandardSource = Buffer.from("UEsDBAoAAAAAAMQDH10AAAAAAAAAAAAAAAAGABwAUkVBRE1FVVQJAAMPy5RqD8uUanV4CwABBOkDAAAE6QMAAFBLAQIeAwoAAAAAAMQDH10AAAAAAAAAAAAAAAAGABgAAAAAAAAAAACkgQAAAABSRUFETUVVVAUAAw/LlGp1eAsAAQTpAwAABOkDAABQSwUGAAAAAAEAAQBMAAAAQAAAAAAA", "base64");

export function standardFirmwareSource(hardwareProfileId: string, adapterVersion: string, target: string): { content: Buffer; name: string } | null {
  if (`${hardwareProfileId}:${adapterVersion}:${target}` === "stmweb.cardputer-adv:1:esp32s3fn8") {
    return { content: cardputerStandardSource, name: "cardputer-adv-standard-firmware.zip" };
  }
  return null;
}

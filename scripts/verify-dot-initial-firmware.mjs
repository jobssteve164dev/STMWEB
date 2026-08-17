import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const buildDirectory = path.resolve(process.argv[2] || "output/firmware/dot-v1");

function parseHex(fileName) {
  const bytes = new Map();
  let upperAddress = 0;
  let eof = false;
  for (const [lineIndex, sourceLine] of readFileSync(path.join(buildDirectory, fileName), "utf8").split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line) continue;
    assert.equal(line[0], ":", `${fileName}:${lineIndex + 1} is not an Intel HEX record`);
    const record = Buffer.from(line.slice(1), "hex");
    assert.equal(record.length, record[0] + 5, `${fileName}:${lineIndex + 1} has an invalid length`);
    assert.equal([...record].reduce((sum, value) => (sum + value) & 0xff, 0), 0, `${fileName}:${lineIndex + 1} has an invalid checksum`);
    const address = record.readUInt16BE(1);
    const type = record[3];
    const data = record.subarray(4, 4 + record[0]);
    if (type === 0) {
      for (const [offset, value] of data.entries()) {
        const absoluteAddress = upperAddress + address + offset;
        if (bytes.has(absoluteAddress)) assert.equal(bytes.get(absoluteAddress), value, `${fileName} contains conflicting data at 0x${absoluteAddress.toString(16)}`);
        bytes.set(absoluteAddress, value);
      }
    } else if (type === 1) {
      eof = true;
    } else if (type === 4) {
      upperAddress = data.readUInt16BE(0) << 16;
    }
  }
  assert.equal(eof, true, `${fileName} is missing its EOF record`);
  return bytes;
}

function u32(bytes, address) {
  return (bytes.get(address) | (bytes.get(address + 1) << 8) | (bytes.get(address + 2) << 16) | (bytes.get(address + 3) << 24)) >>> 0;
}

function assertSubset(expected, combined, label) {
  for (const [address, value] of expected) assert.equal(combined.get(address), value, `${label} differs at 0x${address.toString(16)}`);
}

const bootloader = parseHex("dot_v1_bootloader.hex");
const application = parseHex("dot_v1.hex");
const combined = parseHex("dot_v1_initial_swd.hex");

assertSubset(bootloader, combined, "bootloader");
assertSubset(application, combined, "application");

const bootStack = u32(combined, 0x08000000);
const bootReset = u32(combined, 0x08000004);
const appStack = u32(combined, 0x08004000);
const appReset = u32(combined, 0x08004004);
assert.ok(bootStack >= 0x20000000 && bootStack <= 0x20005000, "bootloader stack is outside SRAM");
assert.ok(bootReset >= 0x08000001 && bootReset < 0x08004000 && (bootReset & 1) === 1, "bootloader reset vector is outside its partition");
assert.ok(appStack >= 0x20000000 && appStack <= 0x20005000, "application stack is outside SRAM");
assert.ok(appReset >= 0x08004001 && appReset < 0x0801fc00 && (appReset & 1) === 1, "application reset vector is outside its partition");
assert.equal(u32(combined, 0x0801fc00), 0x31574653, "factory metadata is missing");
assert.equal(u32(combined, 0x0801fc0c), (~0x31574653) >>> 0, "factory metadata check word is invalid");
assert.ok(Math.max(...application.keys()) < 0x0801fc00, "application overlaps metadata");

process.stdout.write(JSON.stringify({
  bootloaderBytes: bootloader.size - 16,
  applicationBytes: application.size,
  applicationCapacity: 0x0801fc00 - 0x08004000,
  bootReset: `0x${bootReset.toString(16)}`,
  appReset: `0x${appReset.toString(16)}`,
}) + "\n");

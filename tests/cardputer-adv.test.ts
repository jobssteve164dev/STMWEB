import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyCardputerAdvEvent, cardputerAdvCapabilityManifest, cardputerAdvInitialTwin, cardputerAdvKeyRows, parseCardputerAdvStream } from "../src/cardputer-adv.js";

test("parses split Cardputer ADV screen and key events without exposing partial frames", () => {
  const first = parseCardputerAdvStream("", "STMWEB_SCREEN:{\"revision\":4,\"background\":\"#101820\",\"lines\":[\"Ready\",\"BLE connected\"]}\r\nSTMWEB_KEYS:{\"pressed\":[\"fn\",\";\"],");
  assert.deepEqual(first.events, [{ type: "screen", screen: { revision: 4, background: "#101820", lines: ["Ready", "BLE connected"] } }]);
  assert.match(first.carry, /^STMWEB_KEYS:/);
  const second = parseCardputerAdvStream(first.carry, "\"modifiers\":[\"fn\"]}\r\n");
  assert.deepEqual(second.events, [{ type: "keys", keys: { pressed: ["fn", ";"], modifiers: ["fn"] } }]);
  assert.equal(second.carry, "");
});

test("uses the official 4 by 14 Cardputer ADV key layout and Fn arrows", () => {
  assert.equal(cardputerAdvKeyRows.length, 4);
  assert.equal(cardputerAdvKeyRows.every((row) => row.length === 14), true);
  assert.deepEqual(cardputerAdvKeyRows[2].slice(10), ["l", "; ↑", "'", "enter"]);
  assert.deepEqual(cardputerAdvKeyRows[3].slice(9), ["m", ", ←", ". ↓", "/ →", "space"]);
  assert.deepEqual(cardputerAdvCapabilityManifest.capabilities.map((capability) => capability.type), ["display", "keyboard", "battery"]);
});

test("ignores malformed Cardputer ADV frames and continues with the next complete frame", () => {
  const parsed = parseCardputerAdvStream("", "STMWEB_SCREEN:{bad}\nSTMWEB_KEYS:{\"pressed\":[],\"modifiers\":[]}\n");
  assert.deepEqual(parsed.events, [{ type: "keys", keys: { pressed: [], modifiers: [] } }]);
  assert.equal(parsed.carry, "");
});

test("updates the twin and battery telemetry from complete device frames", () => {
  const parsed = parseCardputerAdvStream("", "STMWEB_BATTERY:{\"voltage\":3.91}\nSTMWEB_KEYS:{\"pressed\":[\"a\"],\"modifiers\":[]}\n");
  assert.deepEqual(parsed.events[0], { type: "battery", voltage: 3.91 });
  const next = applyCardputerAdvEvent(cardputerAdvInitialTwin, parsed.events[1]);
  assert.deepEqual(next.keys, { pressed: ["a"], modifiers: [] });
});

test("parses the exact capability frame emitted by the Cardputer firmware", () => {
  const firmwareSource = readFileSync("firmware-adapters/cardputer-adv/main/main.c", "utf8");
  const literal = firmwareSource.match(/publish\("((?:\\.|[^"\\])*)"\);/)?.[1];
  assert.ok(literal, "firmware must publish a capability frame");
  const frame = JSON.parse(`"${literal}"`) as string;
  const parsed = parseCardputerAdvStream("", frame);
  assert.equal(parsed.events[0]?.type, "manifest");
  if (parsed.events[0]?.type === "manifest") {
    assert.equal(parsed.events[0].manifest.device.id, "cardputer-adv");
    assert.deepEqual(parsed.events[0].manifest.capabilities.map((capability) => capability.type), ["display", "keyboard", "battery"]);
  }
});

test("keeps the digital twin lines identical to the physical LCD", () => {
  const main = readFileSync("firmware-adapters/cardputer-adv/main/main.c", "utf8");
  const hardware = readFileSync("firmware-adapters/cardputer-adv/main/cardputer_hardware.c", "utf8");
  const screenLiteral = [...main.matchAll(/publish\("((?:\\.|[^"\\])*)"\);/g)].map((match) => JSON.parse(`"${match[1]}"`) as string)
    .find((frame) => frame.startsWith("STMWEB_SCREEN:"));
  assert.ok(screenLiteral);
  const parsed = parseCardputerAdvStream("", screenLiteral);
  const screen = parsed.events.find((event) => event.type === "screen");
  assert.equal(screen?.type, "screen");
  const lcdLines = [...hardware.matchAll(/draw_text\([^,]+,[^,]+, "([A-Z ]+)"/g)].map((match) => match[1]);
  if (screen?.type === "screen") assert.deepEqual(screen.screen.lines, lcdLines);
});

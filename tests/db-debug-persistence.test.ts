import assert from "node:assert/strict";
import test from "node:test";
import {
  configureWorkspace,
  saveEvent,
  saveSession,
  type DebugEventRecord,
  type DebugSessionRecord,
} from "../src/db.js";

test("persists a new debug session before its first event", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const requests: string[] = [];
  let releaseSessionRequest: (() => void) | undefined;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === `/api/sessions/${sessionId}`) {
      await new Promise<void>((resolve) => { releaseSessionRequest = resolve; });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: url.endsWith("/events") ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  configureWorkspace(workspaceId);
  const session: DebugSessionRecord = {
    id: sessionId,
    projectId: workspaceId,
    deviceName: "DOT",
    connectionLabel: "Bluetooth",
    startedAt: "2026-08-23T10:00:00.000Z",
    status: "recording",
    eventCount: 0,
    isDemo: false,
  };
  const event: DebugEventRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    sessionId,
    sequence: 1,
    recordedAt: "2026-08-23T10:00:01.000Z",
    level: "success",
    message: "会话已开始",
  };

  try {
    const sessionWrite = saveSession(session);
    const eventWrite = saveEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(requests, [`/api/sessions/${sessionId}`]);
    releaseSessionRequest?.();
    await Promise.all([sessionWrite, eventWrite]);
    assert.deepEqual(requests, [
      `/api/sessions/${sessionId}`,
      `/api/sessions/${sessionId}/events`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

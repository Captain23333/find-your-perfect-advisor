import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  claudeControlRequestToPermission,
  claudePermissionResponse,
  createCodexAppServerBridge,
  permissionSessionKey,
} from "../local-runtime/agent-protocols.mjs";

test("Claude stdio permission requests round-trip without parsing stderr", () => {
  const permission = claudeControlRequestToPermission({
    type: "control_request",
    request_id: "request-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: { command: "rg advisor outputs" },
      description: "Search local outputs",
      tool_use_id: "tool-1",
    },
  });

  assert.equal(permission.kind, "command");
  assert.equal(permission.command, "rg advisor outputs");
  assert.equal(permissionSessionKey(permission), "command:rg");
  assert.deepEqual(
    claudePermissionResponse(permission, "allow_once"),
    {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "request-1",
        response: {
          behavior: "allow",
          updatedInput: { command: "rg advisor outputs" },
          toolUseID: "tool-1",
        },
      },
    },
  );
});

test("Codex app-server bridge initializes and returns structured approval decisions", async () => {
  const stdin = new PassThrough();
  const sent = [];
  let pendingText = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    pendingText += chunk;
    const lines = pendingText.split(/\r?\n/);
    pendingText = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) sent.push(JSON.parse(line));
    }
  });

  let permissionRequest = null;
  let permissionResponder = null;
  const bridge = createCodexAppServerBridge({
    child: { stdin },
    cwd: "/tmp/advisor-project",
    prompt: "Find advisors",
    emit() {},
    requestPermission(permission, respond) {
      permissionRequest = permission;
      permissionResponder = respond;
    },
    onTurnComplete() {},
  });

  const started = bridge.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[0].method, "initialize");
  bridge.handleLine(JSON.stringify({ id: sent[0].id, result: {} }));
  await new Promise((resolve) => setImmediate(resolve));

  const threadStart = sent.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.approvalPolicy, "on-request");
  assert.equal(threadStart.params.approvalsReviewer, "user");
  bridge.handleLine(
    JSON.stringify({
      id: threadStart.id,
      result: { thread: { id: "thread-1" } },
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  const turnStart = sent.find((message) => message.method === "turn/start");
  assert.equal(turnStart.params.input[0].text, "Find advisors");
  bridge.handleLine(
    JSON.stringify({
      id: turnStart.id,
      result: { turn: { id: "turn-1" } },
    }),
  );
  await started;

  bridge.handleLine(
    JSON.stringify({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "curl https://example.com",
        cwd: "/tmp/advisor-project",
        reason: "Fetch an official page",
      },
    }),
  );
  assert.equal(permissionRequest.kind, "command");
  assert.equal(permissionRequest.command, "curl https://example.com");
  permissionResponder("allow_for_run");

  const approval = sent.find((message) => message.id === 77);
  assert.deepEqual(approval.result, { decision: "acceptForSession" });
});

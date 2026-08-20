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
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    }),
  );
  const continued = bridge.continueTurn("Continue with degree PhD");
  await new Promise((resolve) => setImmediate(resolve));
  const turnStarts = sent.filter((message) => message.method === "turn/start");
  assert.equal(turnStarts.length, 2);
  assert.equal(turnStarts[1].params.threadId, "thread-1");
  assert.equal(turnStarts[1].params.input[0].text, "Continue with degree PhD");
  bridge.handleLine(
    JSON.stringify({
      id: turnStarts[1].id,
      result: { turn: { id: "turn-2" } },
    }),
  );
  await continued;

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

  bridge.handleLine(
    JSON.stringify({
      id: 78,
      method: "applyPatchApproval",
      params: {
        conversationId: "thread-1",
        callId: "patch-1",
        fileChanges: {
          "/tmp/advisor-project/outputs/candidates.json": {
            type: "update",
            unified_diff: "@@",
            move_path: null,
          },
        },
        reason: "Write the verified shortlist",
        grantRoot: "/tmp/advisor-project",
      },
    }),
  );
  assert.equal(permissionRequest.kind, "file");
  assert.equal(permissionRequest.path, "/tmp/advisor-project");
  permissionResponder("allow_once");

  const patchApproval = sent.find((message) => message.id === 78);
  assert.deepEqual(patchApproval.result, { decision: "approved" });
});

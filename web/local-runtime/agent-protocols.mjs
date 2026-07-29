import { randomUUID } from "node:crypto";

export function writeJsonLine(stream, payload) {
  if (!stream || stream.destroyed || !stream.writable) return false;
  stream.write(`${JSON.stringify(payload)}\n`);
  return true;
}

export function permissionSessionKey(permission) {
  if (permission.kind === "command") {
    const executable = String(permission.command || "")
      .trim()
      .split(/\s+/)[0]
      .slice(0, 120);
    return `command:${executable || permission.toolName || "shell"}`;
  }
  if (permission.kind === "network") {
    const host =
      permission.input?.url ||
      permission.input?.domain ||
      permission.input?.host ||
      permission.reason ||
      "network";
    return `network:${String(host).slice(0, 180)}`;
  }
  return `${permission.kind}:${permission.toolName || "unknown"}`;
}

export function claudeControlRequestToPermission(message) {
  if (message?.type !== "control_request" || !message.request_id) return null;
  const request = message.request || {};
  if (request.subtype !== "can_use_tool") return null;
  const toolName = String(request.tool_name || request.toolName || "Claude tool");
  const input = request.input ?? null;
  const command =
    typeof input?.command === "string"
      ? input.command
      : typeof input?.cmd === "string"
        ? input.cmd
        : null;
  const path =
    typeof input?.file_path === "string"
      ? input.file_path
      : typeof input?.path === "string"
        ? input.path
        : null;
  const kind = command
    ? "command"
    : /web|fetch|search|http/i.test(toolName)
      ? "network"
      : /write|edit|patch|notebook/i.test(toolName)
        ? "file"
        : "tool";

  return {
    providerRequestId: String(message.request_id),
    kind,
    toolName,
    title:
      kind === "command"
        ? "允许执行这条本地命令？"
        : kind === "network"
          ? "允许访问这个网络资源？"
          : kind === "file"
            ? "允许修改本地文件？"
            : `允许 Claude Code 使用 ${toolName}？`,
    description: request.description || request.decision_reason || null,
    reason: request.decision_reason || request.description || null,
    command,
    cwd: input?.cwd || null,
    path,
    input,
    toolUseId: request.tool_use_id || request.toolUseId || null,
    suggestions: request.permission_suggestions || null,
  };
}

export function claudePermissionResponse(permission, decision) {
  const allow = decision !== "deny";
  const response = allow
    ? {
        behavior: "allow",
        updatedInput: permission.input ?? {},
        ...(permission.toolUseId ? { toolUseID: permission.toolUseId } : {}),
      }
    : {
        behavior: "deny",
        message: "用户在 Advisor Atlas 中拒绝了这项操作",
        ...(permission.toolUseId ? { toolUseID: permission.toolUseId } : {}),
      };
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: permission.providerRequestId,
      response,
    },
  };
}

function codexPermissionFromRequest(message) {
  const params = message.params || {};
  if (message.method === "execCommandApproval") {
    return {
      providerRequestId: String(message.id),
      kind: "command",
      toolName: "Shell",
      title: "允许 Codex 执行这条本地命令？",
      description: params.reason || null,
      reason: params.reason || null,
      command: Array.isArray(params.command)
        ? params.command.join(" ")
        : String(params.command || ""),
      cwd: params.cwd || null,
      path: null,
      input: params,
    };
  }
  if (message.method === "applyPatchApproval") {
    const changedPaths = Object.keys(params.fileChanges || {});
    return {
      providerRequestId: String(message.id),
      kind: "file",
      toolName: "File change",
      title: "允许 Codex 修改这些本地文件？",
      description:
        params.reason ||
        (changedPaths.length ? `将修改：${changedPaths.join("、")}` : null),
      reason: params.reason || null,
      command: null,
      cwd: null,
      path: params.grantRoot || changedPaths[0] || null,
      input: params,
    };
  }
  if (message.method === "item/commandExecution/requestApproval") {
    return {
      providerRequestId: String(message.id),
      kind: "command",
      toolName: "Shell",
      title: "允许 Codex 执行这条本地命令？",
      description: params.reason || null,
      reason: params.reason || null,
      command: params.command || null,
      cwd: params.cwd || null,
      path: null,
      input: params,
    };
  }
  if (message.method === "item/fileChange/requestApproval") {
    return {
      providerRequestId: String(message.id),
      kind: "file",
      toolName: "File change",
      title: "允许 Codex 修改这个本地位置？",
      description: params.reason || null,
      reason: params.reason || null,
      command: null,
      cwd: null,
      path: params.grantRoot || null,
      input: params,
    };
  }
  if (message.method === "item/permissions/requestApproval") {
    return {
      providerRequestId: String(message.id),
      kind: params.permissions?.network ? "network" : "permission",
      toolName: params.permissions?.network ? "Network access" : "Additional access",
      title: params.permissions?.network
        ? "允许 Codex 使用额外网络权限？"
        : "允许 Codex 使用额外本地权限？",
      description: params.reason || null,
      reason: params.reason || null,
      command: null,
      cwd: params.cwd || null,
      path: null,
      input: params.permissions || null,
    };
  }
  return null;
}

function codexApprovalResult(method, params, decision) {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return {
      decision:
        decision === "deny"
          ? { denied: { rejection: "用户在 Advisor Atlas 中拒绝了这项操作" } }
          : decision === "allow_for_run"
            ? "approved_for_session"
            : "approved",
    };
  }
  if (method === "item/permissions/requestApproval") {
    return decision === "deny"
      ? { permissions: {}, scope: "turn" }
      : {
          permissions: {
            ...(params.permissions?.network
              ? { network: params.permissions.network }
              : {}),
            ...(params.permissions?.fileSystem
              ? { fileSystem: params.permissions.fileSystem }
              : {}),
          },
          scope: decision === "allow_for_run" ? "session" : "turn",
        };
  }
  return {
    decision:
      decision === "deny"
        ? "decline"
        : decision === "allow_for_run"
          ? "acceptForSession"
          : "accept",
  };
}

export function createCodexAppServerBridge({
  child,
  cwd,
  prompt,
  model = null,
  modelProvider = null,
  emit,
  requestPermission,
  onTurnComplete,
}) {
  let nextId = 1;
  let threadId = null;
  let turnFinished = false;
  const pending = new Map();

  function send(payload) {
    if (!writeJsonLine(child.stdin, { jsonrpc: "2.0", ...payload })) {
      throw new Error("Codex app-server stdin 已关闭");
    }
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      pending.set(String(id), { resolve: resolveRequest, reject: rejectRequest, method });
      send({ id, method, params });
    });
  }

  function respond(id, result) {
    send({ id, result });
  }

  function respondError(id, code, message) {
    send({ id, error: { code, message } });
  }

  async function start() {
    await request("initialize", {
      clientInfo: {
        name: "advisor_atlas",
        title: "Advisor Atlas",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    send({ method: "initialized", params: {} });
    const started = await request("thread/start", {
      cwd,
      runtimeWorkspaceRoots: [cwd],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ephemeral: true,
      ...(model ? { model } : {}),
      ...(modelProvider ? { modelProvider } : {}),
    });
    threadId = started.thread?.id;
    if (!threadId) throw new Error("Codex app-server 没有返回 thread id");
    emit({
      type: "thread.started",
      source: "codex",
      message: `Codex 会话已创建：${threadId}`,
    });
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    });
  }

  function handleServerRequest(message) {
    const permission = codexPermissionFromRequest(message);
    if (permission) {
      requestPermission(permission, (decision) => {
        respond(
          message.id,
          codexApprovalResult(message.method, message.params || {}, decision),
        );
      });
      return true;
    }

    if (message.method === "item/tool/requestUserInput") {
      const questions = message.params?.questions || [];
      emit({
        type: "run.input_required",
        source: "codex",
        message:
          questions.map((question) => question.question).join("\n") ||
          "Codex 需要用户补充信息。请补齐项目资料后重新运行。",
      });
      respond(message.id, {
        answers: Object.fromEntries(
          questions.map((question) => [question.id, { answers: [] }]),
        ),
      });
      return true;
    }
    if (message.method === "currentTime/read") {
      respond(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
      return true;
    }

    emit({
      type: "run.protocol_warning",
      source: "codex",
      message: `Codex 请求了前端尚未支持的操作：${message.method}`,
    });
    respondError(message.id, -32601, `Advisor Atlas 不支持 Codex 请求：${message.method}`);
    return true;
  }

  function handleNotification(message) {
    const method = message.method;
    const params = message.params || {};
    if (method === "turn/started") {
      emit({ type: method, source: "codex", message: "Codex 已开始处理任务" });
      return;
    }
    if (method === "item/agentMessage/delta" && params.delta) {
      emit({ type: method, source: "codex", message: params.delta });
      return;
    }
    if (method === "warning" || method === "error") {
      emit({
        type: method,
        source: "codex",
        message: params.message || params.error?.message || "Codex 返回了一个运行警告",
      });
      return;
    }
    if (method === "turn/completed" && !turnFinished) {
      turnFinished = true;
      const status = params.turn?.status || "completed";
      const error = params.turn?.error?.message || null;
      emit({
        type: method,
        source: "codex",
        message: error || (status === "completed" ? "Codex 本轮任务完成" : `Codex 本轮状态：${status}`),
      });
      onTurnComplete({ status, error });
    }
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const waiter = pending.get(String(message.id));
      if (!waiter) return true;
      pending.delete(String(message.id));
      if (message.error) {
        waiter.reject(
          new Error(message.error.message || `${waiter.method} 请求失败`),
        );
      } else {
        waiter.resolve(message.result);
      }
      return true;
    }
    if (message.id !== undefined && message.method) {
      return handleServerRequest(message);
    }
    if (message.method) {
      handleNotification(message);
      return true;
    }
    return false;
  }

  function fail(error) {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }

  return {
    start,
    handleLine,
    fail,
    get threadId() {
      return threadId;
    },
  };
}

export function normalizePermissionForUi(permission) {
  return {
    id: permission.id || randomUUID(),
    kind: permission.kind,
    toolName: permission.toolName,
    title: permission.title,
    description: permission.description,
    reason: permission.reason,
    command: permission.command,
    cwd: permission.cwd,
    path: permission.path,
    input: permission.input,
    requestedAt: new Date().toISOString(),
  };
}

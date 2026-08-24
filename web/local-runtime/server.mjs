import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  CV_ALLOWED_EXTENSIONS,
  CV_MAX_BYTES,
  createProjectStore,
  cvExtension,
} from "./project-store.mjs";
import {
  communityRefreshEligibility,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";
import {
  claudeControlRequestToPermission,
  claudePermissionResponse,
  createCodexAppServerBridge,
  normalizePermissionForUi,
  permissionSessionKey,
  writeJsonLine,
} from "./agent-protocols.mjs";
import {
  clearCommunityCache,
  getCommunityCacheStatus,
  syncCommunityCache,
} from "./community-cache.mjs";
import { classifyProviderLine } from "./run-events.mjs";
import {
  RUN_EVENT_BUFFER_LIMIT,
  appendToBuffer,
  createRunRegistry,
  markOrphanedRunsInterrupted,
  runSnapshot,
} from "./run-registry.mjs";
import {
  RUN_MODES,
  RUN_MODE_LABELS,
  extractInputRequest,
  parseInputRequest,
  verifyRunArtifacts,
} from "./run-artifacts.mjs";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.ADVISOR_ATLAS_PROJECT_ROOT
  ? resolve(process.env.ADVISOR_ATLAS_PROJECT_ROOT)
  : resolve(runtimeDirectory, "../..");
const dataRoot = resolve(projectRoot, ".advisor-atlas");
const host = process.env.ADVISOR_ATLAS_RUNTIME_HOST || "127.0.0.1";
const hostForUrl = host.includes(":") ? `[${host}]` : host;
const port = Number(process.env.ADVISOR_ATLAS_RUNTIME_PORT || 4318);
const activeRuns = createRunRegistry();
const projectStore = createProjectStore(projectRoot);
const bundledCodexPath = "/Applications/ChatGPT.app/Contents/Resources/codex";
const localCodexScript = resolve(
  runtimeDirectory,
  "../node_modules/@openai/codex/bin/codex.js",
);
const codexCommand = process.env.ADVISOR_ATLAS_CODEX_BIN
  ? {
      executable: process.env.ADVISOR_ATLAS_CODEX_BIN,
      prefixArgs: [],
      source: "configured",
    }
  : existsSync(localCodexScript)
    ? {
        executable: process.execPath,
        prefixArgs: [localCodexScript],
        source: "project-dependency",
      }
    : existsSync(bundledCodexPath)
      ? { executable: bundledCodexPath, prefixArgs: [], source: "chatgpt-app" }
      : { executable: "codex", prefixArgs: [], source: "path" };
const customProviderMetadataPath = resolve(dataRoot, "custom-provider.json");
let customProviderSession = null;

await mkdir(dataRoot, { recursive: true });
await projectStore.ensureDefaultProject();
await markOrphanedRunsInterrupted(projectStore);

function corsHeaders(origin) {
  let allowedOrigin = "http://localhost:3000";
  try {
    const parsed = new URL(origin || allowedOrigin);
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1"
    ) {
      allowedOrigin = origin || allowedOrigin;
    }
  } catch {
    // Keep the local default.
  }

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-file-name,x-file-type,x-project-id",
    "access-control-expose-headers": "content-type",
    vary: "Origin",
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    ...corsHeaders(origin),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request, limit = 128 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new Error("请求内容过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        rejectBody(new Error("请求格式无效"));
      }
    });
    request.on("error", rejectBody);
  });
}

function readBuffer(request, limit = 20 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new Error("文件超过 20 MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });
}

function execText(command, args, timeout = 8000) {
  return new Promise((resolveCommand) => {
    execFile(
      command,
      args,
      {
        cwd: projectRoot,
        timeout,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        resolveCommand({
          ok: !error,
          code: error?.code ?? 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

function execCodexText(args, timeout = 8000) {
  return execText(
    codexCommand.executable,
    [...codexCommand.prefixArgs, ...args],
    timeout,
  );
}

async function readCustomProviderMetadata() {
  try {
    return JSON.parse(await readFile(customProviderMetadataPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("API 地址必须使用 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("API 地址中不能包含账号或密码");
  }
  return parsed.href.replace(/\/+$/, "");
}

async function discoverCustomModels(baseUrl, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `模型列表请求失败（HTTP ${response.status}）`,
      );
    }
    const models = Array.isArray(payload.data)
      ? payload.data
          .map((item) => (typeof item === "string" ? item : item?.id))
          .filter((item) => typeof item === "string" && item.trim())
      : [];
    if (!models.length) {
      throw new Error("接口没有返回可用模型 ID，请确认地址包含正确的 /v1 前缀");
    }
    return [...new Set(models)].sort().slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }
}

async function connectCustomProvider(input) {
  const name = String(input.name || "Custom API").trim().slice(0, 80);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  if (!apiKey) throw new Error("请输入 API Key");

  const appServer = await execCodexText(["app-server", "--help"]);
  if (!appServer.ok) {
    return {
      connected: false,
      runtimeMissing: true,
      error:
        "缺少 Advisor Atlas 的本地 Codex 运行引擎。请在 web 目录运行 npm install 并重启本地控制台；Custom API 使用你填写的 Key，不要求登录 Codex。",
    };
  }

  const models = await discoverCustomModels(baseUrl, apiKey);
  if (!model) {
    return {
      connected: false,
      requiresModel: true,
      models,
      message: "请选择接口返回的精确模型 ID",
    };
  }
  if (!models.includes(model)) {
    return {
      connected: false,
      requiresModel: true,
      models,
      message: `模型 ID “${model}” 不在接口返回列表中`,
    };
  }

  const metadata = {
    name,
    baseUrl,
    model,
    protocol: "responses",
    updatedAt: new Date().toISOString(),
  };
  customProviderSession = { ...metadata, apiKey };
  await writeFile(customProviderMetadataPath, JSON.stringify(metadata, null, 2));
  return {
    connected: true,
    provider: metadata,
    models,
    message: "接口、Key 和模型 ID 已验证",
  };
}

async function providerHealth() {
  const [codexVersion, codexAuth, claudeVersion, claudeAuth] = await Promise.all([
    execCodexText(["--version"]),
    execCodexText(["login", "status"]),
    execText("claude", ["--version"]),
    execText("claude", ["auth", "status"]),
  ]);

  let claudeStatus = {};
  try {
    claudeStatus = JSON.parse(claudeAuth.stdout);
  } catch {
    claudeStatus = {};
  }

  return {
    runtime: {
      online: true,
      projectRoot,
      dataRoot,
    },
    providers: {
      codex: {
        installed: codexVersion.ok,
        loggedIn: /logged in/i.test(`${codexAuth.stdout}\n${codexAuth.stderr}`),
        version: codexVersion.stdout.replace(/^codex-cli\s*/i, "") || null,
        authDetail: codexAuth.stdout || codexAuth.stderr || "未检测到登录状态",
      },
      claude: {
        installed: claudeVersion.ok,
        loggedIn: claudeStatus.loggedIn === true,
        version: claudeVersion.stdout || null,
        authDetail:
          claudeStatus.loggedIn === true
            ? `已通过 ${claudeStatus.authMethod || "Claude"} 登录`
            : "尚未登录 Claude Code",
      },
      custom: {
        installed: codexVersion.ok,
        loggedIn: codexVersion.ok && Boolean(customProviderSession),
        version: customProviderSession?.model || null,
        authDetail: customProviderSession
          ? `已连接 ${customProviderSession.name}`
          : !codexVersion.ok
            ? "缺少本地 Codex 运行引擎；请在 web 目录运行 npm install 后重启"
            : (await readCustomProviderMetadata())
              ? "已保存接口和模型；重启后需重新输入 Key"
              : "尚未配置 OpenAI Responses-compatible API",
      },
    },
  };
}

function safeFilename(value) {
  const decoded = decodeURIComponent(value || "document");
  const cleaned = basename(decoded)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[_\.]+/, "")
    .slice(0, 120);
  return cleaned || "document";
}

function normalizeEvent(provider, line, stream) {
  const level = classifyProviderLine(provider, line, stream);
  if (provider !== "claude" && level === "diagnostic" && stream === "stderr") {
    return {
      type: "diagnostic",
      source: provider,
      level: "diagnostic",
      message: "",
      raw: line,
    };
  }
  if (level === "connection_retry") {
    return {
      type: "connection.retry",
      source: provider,
      level: "warning",
      message: "",
      raw: line,
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      type: stream,
      source: provider,
      message: line,
      raw: line,
    };
  }

  let message = "";
  if (provider !== "claude") {
    if (parsed.fields?.message) {
      message = parsed.fields.message;
    } else if (parsed.type === "thread.started") {
      message = `Codex 会话已创建：${parsed.thread_id || ""}`;
    } else if (parsed.type === "turn.started") {
      message = "Codex 已开始处理任务";
    } else if (parsed.type === "turn.completed") {
      message = "Codex 本轮任务完成";
    } else if (parsed.type === "turn.failed") {
      message = parsed.error?.message || "Codex 任务失败";
    } else if (parsed.item?.type === "agent_message") {
      message = parsed.item.text || "";
    } else if (parsed.item?.type === "command_execution") {
      message = parsed.item.command
        ? `执行：${parsed.item.command}`
        : parsed.item.aggregated_output || "";
    } else if (parsed.item?.type === "reasoning") {
      message = parsed.item.text || "";
    }
  } else if (provider === "claude") {
    if (parsed.type === "system" && parsed.subtype === "init") {
      message = `Claude 会话已创建：${parsed.session_id || ""}`;
    } else if (parsed.type === "result") {
      message = parsed.result || (parsed.is_error ? "Claude 任务失败" : "Claude 任务完成");
    } else if (parsed.type === "assistant") {
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        message = content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
      }
    }
  }

  return {
    type: parsed.type || stream,
    source: provider,
    level: stream === "stderr" ? (level === "error" ? "error" : "diagnostic") : "progress",
    message,
    raw: parsed,
  };
}

// Collect every descendant of rootPid by walking parent/child links strictly
// downward. Never traverse toward parents: the user's own terminals live in a
// different subtree and must stay untouched. Do not replace this with
// name-based matching (`pkill -f claude`) — that would also kill the user's
// unrelated CLI sessions.
async function collectDescendantPids(rootPid) {
  if (!rootPid || rootPid <= 1) return [];
  const listing = await execText("ps", ["-A", "-o", "pid=,ppid="], 4000);
  if (!listing.ok) return [];

  const childrenByParent = new Map();
  for (const line of listing.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }

  const descendants = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    for (const pid of childrenByParent.get(queue.shift()) || []) {
      if (seen.has(pid) || pid <= 1 || pid === process.pid) continue;
      seen.add(pid);
      descendants.push(pid);
      queue.push(pid);
    }
  }
  return descendants;
}

// Replaces the previous `process.kill(-pid)` process-group kill, which required
// spawning with `detached: true`. That option is rejected with EINVAL on some
// platforms, so the run is now spawned in the parent's process group and torn
// down by walking the process tree instead.
async function killProcessTree(child, signal) {
  const rootPid = child.pid;
  if (!rootPid) return;

  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      await execText("taskkill", ["/PID", String(rootPid), "/T", "/F"], 4000);
    } else {
      try {
        child.kill(signal);
      } catch {
        // The process has already exited.
      }
    }
    return;
  }

  // Deepest-first, so a dying parent cannot spawn survivors that escape the
  // snapshot before we reach them.
  const descendants = await collectDescendantPids(rootPid);
  for (const pid of descendants.reverse()) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process has already exited, or its PID was recycled.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process has already exited.
  }
}

function terminateRun(runId) {
  const run = activeRuns.get(runId);
  if (!run || run.finished) return false;
  run.stopped = true;
  for (const pending of run.permissions?.values() || []) {
    try {
      pending.respond("deny");
    } catch {
      // The provider may already have closed stdin.
    }
  }
  run.permissions?.clear();

  void killProcessTree(run.child, "SIGTERM");

  setTimeout(() => {
    if (run.child.exitCode === null) {
      void killProcessTree(run.child, "SIGKILL");
    }
  }, 2500).unref();
  return true;
}

function requestRunPermission(run, providerPermission, respond) {
  const permission = normalizePermissionForUi({
    ...providerPermission,
    id: randomUUID(),
  });
  const sessionKey = permissionSessionKey(providerPermission);

  if (run.sessionPermissionKeys.has(sessionKey)) {
    respond("allow_once");
    run.emit({
      type: "permission.auto_approved",
      source: "runtime",
      message: `已按“本次运行允许”继续：${permission.toolName}`,
      permission,
    });
    return;
  }

  run.permissions.set(permission.id, {
    permission,
    sessionKey,
    respond,
  });
  run.emit({
    type: "permission.requested",
    source: "runtime",
    level: "action_required",
    message: `${permission.title} Agent 已暂停，等待你的选择。`,
    permission,
  });
}

function resolveRunPermission(runId, permissionId, decision) {
  const run = activeRuns.get(runId);
  if (!run || run.finished) return { ok: false, status: 404, error: "运行任务不存在或已经结束" };
  const pending = run.permissions.get(permissionId);
  if (!pending) return { ok: false, status: 404, error: "授权请求不存在或已经处理" };
  if (!["allow_once", "allow_for_run", "deny"].includes(decision)) {
    return { ok: false, status: 400, error: "无效的授权决定" };
  }

  if (decision === "allow_for_run" && run.metadata.provider === "claude") {
    run.sessionPermissionKeys.add(pending.sessionKey);
  }
  pending.respond(decision);
  run.permissions.delete(permissionId);
  run.emit({
    type: "permission.resolved",
    source: "runtime",
    message:
      decision === "deny"
        ? `已拒绝：${pending.permission.toolName}`
        : decision === "allow_for_run"
          ? `本次运行将继续允许同类操作：${pending.permission.toolName}`
          : `已允许一次：${pending.permission.toolName}`,
    permissionId,
    decision,
  });
  return { ok: true, status: 200 };
}

async function writeRunMetadata(runDirectory, metadata) {
  await writeFile(
    resolve(runDirectory, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function attachRunStream(run, response, origin) {
  response.writeHead(200, {
    ...corsHeaders(origin),
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Replay first so a reopened panel shows the same log it had before, then
  // hand the caller everything it needs to restore its own UI state.
  for (const line of run.eventBuffer) {
    if (!response.destroyed) response.write(line);
  }
  const attached = {
    runId: run.id,
    at: new Date().toISOString(),
    type: "run.attached",
    source: "runtime",
    message: "已重新接入正在运行的任务",
    status: run.metadata.status,
    mode: run.metadata.mode,
    outputDirectory: run.metadata.outputDirectory,
    pendingPermissions: [...run.permissions.values()].map(
      (pending) => pending.permission,
    ),
    requestedInput: run.requestedInput || run.metadata.requestedInput || null,
  };
  if (!response.destroyed) response.write(`${JSON.stringify(attached)}\n`);
  run.subscribers.add(response);
  response.on("close", () => run.subscribers.delete(response));
}

async function listRecentRuns(projectId) {
  const project = await projectStore.getProject(projectId);
  const runsRoot = resolve(project.path, "runs");
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const records = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(resolve(runsRoot, entry.name, "metadata.json"), "utf8");
      records.push(JSON.parse(raw));
    } catch {
      // Ignore incomplete run folders.
    }
  }

  return records
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, 20);
}

async function startRun(request, response, origin) {
  const body = await readJson(request);
  const provider = body.provider;
  const projectId = String(body.projectId || "").trim();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const mode = String(body.mode || "finder").trim();
  const confirmedRevision = Number.isInteger(body.confirmedRevision)
    ? body.confirmedRevision
    : null;

  if (!RUN_MODES.includes(mode)) {
    sendJson(response, 400, { error: "未知的运行阶段" }, origin);
    return;
  }

  if (!["codex", "claude", "custom"].includes(provider)) {
    sendJson(
      response,
      400,
      { error: "当前仅支持 Codex、Claude Code 或自定义 Responses API" },
      origin,
    );
    return;
  }
  if (!projectId) {
    sendJson(response, 400, { error: "请选择一个申请项目" }, origin);
    return;
  }
  const runningForProject = activeRuns.activeForProject(projectId);
  if (runningForProject) {
    sendJson(
      response,
      409,
      {
        error: "该申请项目已有任务正在运行，请先接入或取消它",
        activeRun: runSnapshot(runningForProject),
      },
      origin,
    );
    return;
  }
  if (!prompt || prompt.length > 60_000) {
    sendJson(response, 400, { error: "请输入有效任务指令（最多 60,000 字）" }, origin);
    return;
  }
  const project = await projectStore.getProject(projectId);
  if (
    mode === "detective" &&
    confirmedRevision !== null &&
    confirmedRevision !== project.investigation?.confirmed?.revision
  ) {
    sendJson(
      response,
      409,
      { error: "调查配置已更新，请刷新项目后按当前确认版本重新启动" },
      origin,
    );
    return;
  }
  // Each stage has its own preconditions; Phase 2 and Phase 3 must stay usable
  // on a project whose Phase 1 inputs are no longer complete.
  const modeReadiness = project.readiness.modes?.[mode];
  if (modeReadiness && !modeReadiness.ready) {
    sendJson(
      response,
      422,
      {
        error: `开始${RUN_MODE_LABELS[mode]}前，请先完成：${modeReadiness.missing.join("、")}`,
        missingInputs: modeReadiness.missing,
        mode,
        readiness: project.readiness,
      },
      origin,
    );
    return;
  }
  if (activeRuns.size >= 2) {
    sendJson(response, 429, { error: "当前已有两个本地任务正在运行" }, origin);
    return;
  }

  const health = await providerHealth();
  const selectedHealth = health.providers[provider];
  if (!selectedHealth.installed || !selectedHealth.loggedIn) {
    sendJson(
      response,
      409,
      {
        error: `${
          provider === "codex"
            ? "Codex"
            : provider === "claude"
              ? "Claude Code"
              : "自定义 API"
        } 尚未安装、登录或完成验证`,
        provider: selectedHealth,
      },
      origin,
    );
    return;
  }

  const runId = randomUUID();
  const runDirectory = resolve(project.path, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  await projectStore.syncProjectSkills(projectId);

  const skillPath =
    provider === "claude"
      ? resolve(project.path, ".claude/skills/advisor-pipeline/SKILL.md")
      : resolve(project.path, ".agents/skills/advisor-pipeline/SKILL.md");
  const effectivePrompt = `${prompt}

本地控制台运行约束：
1. 当前唯一申请项目目录为：${project.path}
2. 导师匹配总技能入口为：${skillPath}
3. 本次运行的专属输出目录为：${runDirectory}
4. 共享状态文件写入申请项目目录，最终表格和报告写入 ${resolve(project.path, "outputs")}，本次临时记录写入运行目录。
5. 不得编造 CV、导师、招生状态或申请者经历。Phase 1 的启动条件是目标范围，以及 CV 或至少一个研究兴趣；目标学位和申请季最迟必须在客观申请条件筛选前补齐。
6. 每完成一个阶段，都要把真实进度同步到 ${resolve(project.path, "status.json")}。保留 JSON 格式，并使用：
   {"schemaVersion":2,"phase":"intake|finder|detective|evaluator|completed","stage":"intake|discovery|research_fit|objective_screen|selection|investigation|ranking|completed","candidateCount":0,"shortlistCount":0,"objectiveReadyCount":0,"selectedCount":0,"evidenceCount":0,"evidenceCoverage":0,"rankingCount":0,"updatedAt":"ISO-8601 时间"}
   数字必须来自该项目实际产物；尚未产生的结果保持 0，不能用界面演示数字填充。
7. Phase 1 产生候选并完成客观筛选后，同步写入 ${resolve(project.path, "outputs", "candidates.json")}。每项至少使用：
   {"advisorProgramId":"稳定ID","rank":1,"initials":"AB","name":"真实姓名","school":"真实院校","program":"真实项目","fit":0.0,"status":"已核实状态或待核实","statusTone":"open|caution|closed|unknown","feasibility":"eligible|ineligible|needs_confirmation","feasibilityReasons":[],"directions":["方向"],"evidence":0}
   每项必须可追溯到真实检索结果；不确定字段要标为待核实，不能补写演示人物。
8. 本次项目最终确认的调查配置为：${JSON.stringify(project.investigation?.confirmed || null, null, 2)}
   必须使用其中精确的 selectedAdvisorProgramIds 和 selectedSections，不能只按人数或 Top N 猜测。
   写 outputs/detective-results.json 时，顶层必须带上 "confirmedRevision": ${
     project.investigation?.confirmed?.revision ?? "null"
   } 和 "confirmedFingerprint": ${JSON.stringify(
     project.investigation?.confirmed?.fingerprint || null,
   )}，以及 "generatedAt"。每个已选维度都必须给出结论，或显式写成 {"status":"not_completed","summary":"原因"}；不能留空。
9. Web 社区资料缓存目录为：${resolve(project.path, "community-cache")}。只有 communitySources.consented 为 true 且相关维度被选中时才可读取；searchReady 不为 true 时必须写“未完成检索”。
10. Phase 1 目标 shortlist 数量为 ${project.shortlistTarget}。发现池大小必须服从用户范围：如果是一个明确学校、院系、研究所或实验室，覆盖其官方名册中合理相关且具备指导资格的人，不得为了凑数硬扩到 30，通常以约 ${Math.min(
    60,
    project.shortlistTarget * 2,
  )} 位相关候选为目标；只有跨校或地区级宽范围搜索才以约 ${Math.min(
    60,
    project.shortlistTarget * 3,
  )} 位为目标。再按研究匹配与客观条件筛到目标数量；不得把 Phase 2 的社区风评、组内生态或全面社交调查提前到 Phase 1。
11. 不要执行 git commit、git push、发布、发送邮件或任何对外提交操作。
12. 如果缺少继续所需的申请资料（例如目标学位或申请季），不要在对话里提问后空转，也不要自行假设。请单独输出一行 JSON：
   {"type":"input.requested","reason":"简短说明","fields":[{"id":"degree","label":"目标学位","required":true}]}
   允许的 field id 只有 degree、season、target、interests、shortlistTarget。输出后结束本轮，控制台会收集答案并让你继续。`;

  const command =
    provider === "codex"
      ? {
          executable: codexCommand.executable,
          args: [...codexCommand.prefixArgs, "app-server", "--stdio"],
        }
      : provider === "claude"
        ? {
            executable: "claude",
            args: [
              "--print",
              "--input-format",
              "stream-json",
              "--output-format",
              "stream-json",
              "--verbose",
              "--permission-mode",
              "default",
              "--permission-prompt-tool",
              "stdio",
              "--setting-sources",
              "user,project,local",
            ],
          }
        : {
            executable: codexCommand.executable,
            args: [
              ...codexCommand.prefixArgs,
              "app-server",
              "--stdio",
              "-c",
              'model_provider="advisor_custom"',
              "-c",
              `model_providers.advisor_custom.name=${JSON.stringify(customProviderSession.name)}`,
              "-c",
              `model_providers.advisor_custom.base_url=${JSON.stringify(customProviderSession.baseUrl)}`,
              "-c",
              'model_providers.advisor_custom.env_key="ADVISOR_ATLAS_CUSTOM_API_KEY"',
              "-c",
              'model_providers.advisor_custom.wire_api="responses"',
            ],
          };

  const metadata = {
    id: runId,
    projectId: project.id,
    provider,
    mode,
    status: "running",
    // Which confirmation snapshot this run was launched against. Artifacts that
    // belong to an older revision must not count as this run finishing.
    confirmedRevision:
      confirmedRevision ?? project.investigation?.confirmed?.revision ?? null,
    confirmedFingerprint: project.investigation?.confirmed?.fingerprint || null,
    prompt,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    missingArtifacts: [],
    requestedInput: null,
    outputDirectory: runDirectory,
  };
  await writeRunMetadata(runDirectory, metadata);
  const eventLog = createWriteStream(resolve(runDirectory, "events.ndjson"), {
    flags: "a",
  });

  response.writeHead(200, {
    ...corsHeaders(origin),
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const eventBuffer = [];
  const subscribers = new Set([response]);
  let run = null;
  let agentMessageBuffer = "";
  response.on("close", () => subscribers.delete(response));

  const writeEvent = (event) => {
    const line = `${JSON.stringify({ runId, at: new Date().toISOString(), ...event })}\n`;
    eventLog.write(line);
    appendToBuffer(eventBuffer, line, RUN_EVENT_BUFFER_LIMIT);
    for (const subscriber of subscribers) {
      if (!subscriber.destroyed) subscriber.write(line);
    }
  };

  const emit = (event) => {
    if (
      run &&
      !run.requestedInput &&
      event.source !== "runtime" &&
      typeof event.message === "string"
    ) {
      agentMessageBuffer = `${agentMessageBuffer}${event.message}`.slice(-20_000);
      const inputRequest =
        parseInputRequest(event.raw) || extractInputRequest(agentMessageBuffer);
      if (inputRequest) {
        run.requestedInput = inputRequest;
        writeEvent({
          type: "input.requested",
          source: "runtime",
          level: "action_required",
          message:
            inputRequest.reason ||
            "Agent 需要你补充申请资料后才能继续客观筛选",
          requestedInput: inputRequest,
        });
      }
    }
    writeEvent(event);
  };

  emit({
    type: "run.started",
    source: "runtime",
    level: "progress",
    message: `已通过 ${
      provider === "codex"
        ? "Codex"
        : provider === "claude"
          ? "Claude Code"
          : customProviderSession.name
    } 启动本地任务`,
    outputDirectory: runDirectory,
  });

  const child = spawn(command.executable, command.args, {
    cwd: project.path,
    env: {
      ...process.env,
      ...(provider === "custom"
        ? { ADVISOR_ATLAS_CUSTOM_API_KEY: customProviderSession.apiKey }
        : {}),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    // Deliberately not `detached: true`: the underlying setsid flag is rejected
    // with EINVAL on some platforms and aborts the run before the provider ever
    // starts. Teardown walks the process tree instead — see killProcessTree.
    stdio: ["pipe", "pipe", "pipe"],
  });

  run = {
    id: runId,
    child,
    response,
    metadata,
    runDirectory,
    projectPath: project.path,
    eventBuffer,
    subscribers,
    eventLog,
    finished: false,
    stopped: false,
    protocolCompleted: false,
    protocolError: null,
    requestedInput: null,
    retryCount: 0,
    permissions: new Map(),
    sessionPermissionKeys: new Set(),
    emit,
  };
  activeRuns.register(run);

  async function finishOrPauseTurn({ succeeded, error = null }) {
    run.protocolCompleted = succeeded;
    run.protocolError = error;
    if (succeeded && run.requestedInput && !run.stopped) {
      try {
        metadata.status = "needs_input";
        metadata.requestedInput = run.requestedInput;
        await writeRunMetadata(runDirectory, metadata);
        emit({
          type: "run.waiting_input",
          source: "runtime",
          level: "action_required",
          message: "Agent 会话已暂停，补充资料后将从同一会话继续",
          status: "needs_input",
          requestedInput: run.requestedInput,
        });
        return;
      } catch (metadataError) {
        run.protocolCompleted = false;
        run.protocolError = `无法保存等待输入状态：${metadataError.message}`;
      }
    }
    child.kill("SIGTERM");
  }

  const requestPermission = (permission, respond) =>
    requestRunPermission(run, permission, respond);
  const codexBridge =
    provider === "codex" || provider === "custom"
      ? createCodexAppServerBridge({
          child,
          cwd: project.path,
          prompt: effectivePrompt,
          model: provider === "custom" ? customProviderSession.model : null,
          modelProvider: provider === "custom" ? "advisor_custom" : null,
          emit,
          requestPermission,
          onTurnComplete: ({ status, error }) => {
            void finishOrPauseTurn({
              succeeded: status === "completed",
              error,
            });
          },
        })
      : null;

  run.continueTurn = async (continuationPrompt) => {
    run.protocolCompleted = false;
    run.protocolError = null;
    agentMessageBuffer = "";
    if (provider === "claude") {
      if (
        !writeJsonLine(child.stdin, {
          type: "user",
          message: { role: "user", content: continuationPrompt },
        })
      ) {
        throw new Error("Claude 会话已经关闭，无法继续");
      }
      return;
    }
    await codexBridge.continueTurn(continuationPrompt);
  };

  function handleProviderLine(line, streamName) {
    if (streamName === "stdout" && codexBridge?.handleLine(line)) return;

    if (streamName === "stdout" && provider === "claude") {
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Fall through to the ordinary stream renderer.
      }
      const permission = claudeControlRequestToPermission(parsed);
      if (permission) {
        requestPermission(permission, (decision) => {
          writeJsonLine(child.stdin, claudePermissionResponse(permission, decision));
        });
        return;
      }
      if (parsed?.type === "control_request") {
        writeJsonLine(child.stdin, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: parsed.request_id,
            response: {
              behavior: "deny",
              message: `Advisor Atlas 暂不支持 ${parsed.request?.subtype || "未知"} 控制请求`,
            },
          },
        });
        return;
      }
      if (parsed?.type === "result") {
        void finishOrPauseTurn({
          succeeded: !parsed.is_error,
          error: parsed.is_error ? parsed.result || "Claude 任务失败" : null,
        });
      }
    }

    const event = normalizeEvent(provider, line, streamName);
    if (event.type === "connection.retry") {
      // Repeated reconnect noise collapses into one counted line instead of a
      // wall of HTTP 502 / MCP failures on the main progress log.
      run.retryCount = (run.retryCount || 0) + 1;
      emit({
        type: "connection.retry",
        source: "runtime",
        level: "warning",
        message: `模型工具连接不稳定，正在重试（第 ${run.retryCount} 次）`,
        retryCount: run.retryCount,
        raw: event.raw,
      });
      return;
    }
    const inputRequest =
      parseInputRequest(event.raw) || extractInputRequest(event.message);
    if (inputRequest && !run.requestedInput) {
      run.requestedInput = inputRequest;
      emit({
        type: "input.requested",
        source: "runtime",
        level: "action_required",
        message:
          inputRequest.reason ||
          "Agent 需要你补充申请资料后才能继续客观筛选",
        requestedInput: inputRequest,
      });
    }
    if (event.message || streamName === "stderr") emit(event);
  }

  for (const [streamName, stream] of [
    ["stdout", child.stdout],
    ["stderr", child.stderr],
  ]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handleProviderLine(line, streamName);
      }
    });
    stream.on("end", () => {
      if (pending.trim()) handleProviderLine(pending, streamName);
    });
  }

  if (provider === "claude") {
    writeJsonLine(child.stdin, {
      type: "user",
      message: {
        role: "user",
        content: effectivePrompt,
      },
    });
  } else {
    void codexBridge.start().catch((error) => {
      run.protocolError = error.message;
      emit({
        type: "run.error",
        source: "runtime",
        message: `Codex app-server 启动失败：${error.message}`,
      });
      child.kill("SIGTERM");
    });
  }

  child.on("error", async (error) => {
    codexBridge?.fail(error);
    run.protocolError = error.message;
    emit({
      type: "run.error",
      source: "runtime",
      level: "error",
      message: error.message,
    });
  });

  child.on("close", async (code, signal) => {
    run.finished = true;
    codexBridge?.fail(new Error("Codex app-server 已关闭"));
    for (const pendingPermission of run.permissions.values()) {
      try {
        pendingPermission.respond("deny");
      } catch {
        // Provider stdin may already be closed.
      }
    }
    run.permissions.clear();

    const modelSucceeded =
      run.protocolCompleted || (provider === "claude" && code === 0);
    // The model returning a sentence is not the same as the phase producing its
    // artifact, so a "successful" turn still has to be checked against disk.
    const verification = modelSucceeded
      ? await verifyRunArtifacts({
          projectPath: project.path,
          mode,
          confirmedRevision: metadata.confirmedRevision,
          confirmedFingerprint: metadata.confirmedFingerprint,
          selectedAdvisorProgramIds:
            project.investigation?.confirmed?.selectedAdvisorProgramIds || [],
          selectedSections:
            project.investigation?.confirmed?.selectedSections || [],
          startedAt: metadata.startedAt,
        }).catch((error) => ({
          complete: false,
          missing: [`产物校验失败：${error.message}`],
        }))
      : { complete: false, missing: [] };

    const waitingSessionExited =
      metadata.status === "needs_input" && Boolean(run.requestedInput);
    metadata.status = run.stopped
      ? "cancelled"
      : waitingSessionExited
        ? "interrupted"
      : modelSucceeded
        ? verification.complete
          ? "completed"
          : run.requestedInput
            ? "needs_input"
            : "partial"
        : "failed";
    metadata.missingArtifacts = verification.missing || [];
    metadata.requestedInput = run.requestedInput || null;
    metadata.finishedAt = new Date().toISOString();
    metadata.exitCode = code;
    metadata.signal = signal;
    await writeRunMetadata(runDirectory, metadata);
    emit({
      type: "run.finished",
      source: "runtime",
      level: metadata.status === "completed" ? "progress" : "warning",
      message:
        metadata.status === "completed"
          ? "本地任务已完成"
          : metadata.status === "cancelled"
            ? "本地任务已取消"
            : metadata.status === "interrupted"
              ? "Agent 会话在等待补充资料时意外关闭，请检查已有产物后重新启动"
            : metadata.status === "needs_input"
              ? "本轮已结束，Agent 需要你补充信息后才能继续"
              : metadata.status === "partial"
                ? `本轮已结束，但尚未产生${RUN_MODE_LABELS[mode]}`
                : run.protocolError ||
                  `本地任务异常结束（退出码 ${code ?? "unknown"}）`,
      status: metadata.status,
      mode,
      missingArtifacts: metadata.missingArtifacts,
      requestedInput: metadata.requestedInput,
      exitCode: code,
    });
    eventLog.end();
    for (const subscriber of subscribers) {
      if (!subscriber.destroyed) subscriber.end();
    }
    subscribers.clear();
    activeRuns.release(runId);
  });
}

async function continueRunWithInput(runId, body) {
  const run = activeRuns.get(runId);
  if (!run || run.finished) {
    return { ok: false, status: 404, error: "运行任务不存在或已经结束" };
  }
  if (!run.requestedInput || run.metadata.status !== "needs_input") {
    return { ok: false, status: 409, error: "当前任务没有等待补充资料" };
  }
  const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
  const missing = run.requestedInput.fields.filter(
    (field) => field.required && !String(answers[field.id] || "").trim(),
  );
  if (missing.length) {
    return {
      ok: false,
      status: 422,
      error: `还需要填写：${missing.map((field) => field.label || field.id).join("、")}`,
    };
  }

  const answeredLines = run.requestedInput.fields
    .map((field) => {
      const value = String(answers[field.id] || "").trim();
      return value ? `- ${field.label || field.id}：${value}` : null;
    })
    .filter(Boolean)
    .join("\n");
  const continuationPrompt = `用户已补充以下资料：\n${answeredLines}\n\n请在当前会话中继续本阶段，复用已经完成的工作，不要重新执行已有检索。`;
  const previousRequest = run.requestedInput;
  run.requestedInput = null;
  run.metadata.requestedInput = null;
  run.metadata.status = "running";
  try {
    await writeRunMetadata(run.runDirectory, run.metadata);
    await run.continueTurn(continuationPrompt);
    run.emit({
      type: "run.continued",
      source: "runtime",
      level: "progress",
      message: "资料已保存，Agent 正从同一会话继续",
      status: "running",
    });
    return { ok: true, status: 202 };
  } catch (error) {
    run.requestedInput = previousRequest;
    run.metadata.requestedInput = previousRequest;
    run.metadata.status = "needs_input";
    await writeRunMetadata(run.runDirectory, run.metadata).catch(() => {});
    return { ok: false, status: 409, error: error.message || "Agent 会话无法继续" };
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const requestUrl = new URL(request.url || "/", `http://${hostForUrl}:${port}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, await providerHealth(), origin);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/projects") {
      sendJson(
        response,
        200,
        {
          root: projectStore.projectsRoot,
          projects: await projectStore.listProjects(),
        },
        origin,
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
      const body = await readJson(request);
      const project = await projectStore.createProject(body);
      sendJson(response, 201, { project }, origin);
      return;
    }

    const projectMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (request.method === "GET" && projectMatch) {
      sendJson(
        response,
        200,
        { project: await projectStore.getProject(projectMatch[1]) },
        origin,
      );
      return;
    }
    if (request.method === "PATCH" && projectMatch) {
      const body = await readJson(request);
      sendJson(
        response,
        200,
        { project: await projectStore.updateProject(projectMatch[1], body) },
        origin,
      );
      return;
    }
    if (request.method === "DELETE" && projectMatch) {
      const projectId = projectMatch[1];
      const running = activeRuns.activeForProject(projectId);
      if (running) {
        sendJson(
          response,
          409,
          { error: "这个项目仍有任务正在运行，请先取消或等待任务结束" },
          origin,
        );
        return;
      }
      const project = await projectStore.getProject(projectId);
      const body = await readJson(request);
      if (String(body.confirmName || "") !== project.name) {
        sendJson(
          response,
          422,
          { error: "项目名称不匹配，未删除任何本地文件" },
          origin,
        );
        return;
      }
      const deleted = await projectStore.deleteProject(projectId);
      sendJson(response, 200, { deleted }, origin);
      return;
    }

    const investigationConfirmMatch = requestUrl.pathname.match(
      /^\/api\/projects\/([^/]+)\/investigation\/confirm$/,
    );
    if (request.method === "POST" && investigationConfirmMatch) {
      const body = await readJson(request);
      try {
        const project = await projectStore.confirmInvestigation(
          investigationConfirmMatch[1],
          body,
        );
        sendJson(response, 200, { project }, origin);
      } catch (error) {
        const status = error.code === "STALE_DRAFT" ? 409 : 422;
        sendJson(response, status, { error: error.message }, origin);
      }
      return;
    }

    const communityMatch = requestUrl.pathname.match(
      /^\/api\/projects\/([^/]+)\/community-cache$/,
    );
    if (request.method === "GET" && communityMatch) {
      const project = await projectStore.getProject(communityMatch[1]);
      sendJson(
        response,
        200,
        { cache: await getCommunityCacheStatus(project.path) },
        origin,
      );
      return;
    }
    if (request.method === "POST" && communityMatch) {
      const project = await projectStore.getProject(communityMatch[1]);
      const eligibility = communityRefreshEligibility(project.investigation);
      if (!eligibility.allowed) {
        sendJson(
          response,
          eligibility.reason?.includes("发生变化") ? 409 : 403,
          { error: eligibility.reason },
          origin,
        );
        return;
      }
      const cache = await syncCommunityCache(project.path);
      sendJson(response, cache.searchReady ? 200 : 422, { cache }, origin);
      return;
    }
    if (request.method === "DELETE" && communityMatch) {
      const project = await projectStore.getProject(communityMatch[1]);
      sendJson(
        response,
        200,
        { cache: await clearCommunityCache(project.path) },
        origin,
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/custom-provider/connect"
    ) {
      const body = await readJson(request);
      const result = await connectCustomProvider(body);
      sendJson(response, result.connected ? 200 : 422, result, origin);
      return;
    }

    if (
      request.method === "DELETE" &&
      requestUrl.pathname === "/api/custom-provider"
    ) {
      customProviderSession = null;
      await unlink(customProviderMetadataPath).catch(() => {});
      sendJson(response, 200, { disconnected: true }, origin);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/runs") {
      const projectId = requestUrl.searchParams.get("projectId");
      if (!projectId) {
        sendJson(response, 400, { error: "缺少 projectId" }, origin);
        return;
      }
      sendJson(
        response,
        200,
        {
          active: activeRuns.activeList(projectId).map((run) => runSnapshot(run)),
          recent: await listRecentRuns(projectId),
        },
        origin,
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/files") {
      const projectId = String(request.headers["x-project-id"] || "");
      if (!projectId) {
        sendJson(response, 400, { error: "请选择申请项目后再上传文件" }, origin);
        return;
      }
      const project = await projectStore.getProject(projectId);
      const fileName = safeFilename(request.headers["x-file-name"]);
      const extension = cvExtension(fileName);
      if (!CV_ALLOWED_EXTENSIONS.has(extension)) {
        sendJson(
          response,
          415,
          { error: "只支持 PDF / DOC / DOCX / TXT / MD 格式的 CV" },
          origin,
        );
        return;
      }
      const fileId = randomUUID();
      const buffer = await readBuffer(request, CV_MAX_BYTES);
      if (!buffer.length) {
        sendJson(response, 400, { error: "文件内容为空" }, origin);
        return;
      }
      if (buffer.length > CV_MAX_BYTES) {
        sendJson(
          response,
          413,
          {
            error: `CV 超过 ${Math.round(CV_MAX_BYTES / (1024 * 1024))} MB 上限`,
          },
          origin,
        );
        return;
      }
      await mkdir(resolve(project.path, "inputs"), { recursive: true });
      const relativePath = `inputs/${fileId}-${fileName}`;
      const filePath = resolve(project.path, relativePath);
      // Write to a scratch name first: if validation fails, the previously
      // saved CV is still the one recorded in project.json.
      const stagingPath = `${filePath}.uploading`;
      await writeFile(stagingPath, buffer);
      let updatedProject = null;
      try {
        await rename(stagingPath, filePath);
        updatedProject = await projectStore.setProjectCv(projectId, {
          name: fileName,
          path: relativePath,
          size: buffer.length,
          type: request.headers["x-file-type"] || "application/octet-stream",
        });
      } catch (error) {
        await unlink(stagingPath).catch(() => {});
        await unlink(filePath).catch(() => {});
        sendJson(
          response,
          error.code === "INVALID_CV" ? 422 : 500,
          { error: error.message || "CV 保存失败，已保留原有 CV" },
          origin,
        );
        return;
      }
      sendJson(
        response,
        201,
        {
          id: fileId,
          name: fileName,
          size: buffer.length,
          type: request.headers["x-file-type"] || "application/octet-stream",
          path: relativePath,
          absolutePath: filePath,
          readiness: updatedProject.readiness,
        },
        origin,
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/runs") {
      await startRun(request, response, origin);
      return;
    }

    const permissionMatch = requestUrl.pathname.match(
      /^\/api\/runs\/([^/]+)\/permissions\/([^/]+)$/,
    );
    if (request.method === "POST" && permissionMatch) {
      const body = await readJson(request);
      const result = resolveRunPermission(
        permissionMatch[1],
        permissionMatch[2],
        body.decision,
      );
      sendJson(
        response,
        result.status,
        result.ok ? { ok: true } : { error: result.error },
        origin,
      );
      return;
    }

    const continueMatch = requestUrl.pathname.match(
      /^\/api\/runs\/([^/]+)\/continue$/,
    );
    if (request.method === "POST" && continueMatch) {
      const result = await continueRunWithInput(
        continueMatch[1],
        await readJson(request),
      );
      sendJson(
        response,
        result.status,
        result.ok ? { ok: true } : { error: result.error },
        origin,
      );
      return;
    }

    const runStreamMatch = requestUrl.pathname.match(
      /^\/api\/runs\/([^/]+)\/stream$/,
    );
    if (request.method === "GET" && runStreamMatch) {
      const run = activeRuns.get(runStreamMatch[1]);
      if (!run || run.finished) {
        sendJson(response, 404, { error: "运行任务不存在或已经结束" }, origin);
        return;
      }
      attachRunStream(run, response, origin);
      return;
    }

    const stopMatch = requestUrl.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (request.method === "POST" && stopMatch) {
      const stopped = terminateRun(stopMatch[1]);
      sendJson(
        response,
        stopped ? 202 : 404,
        stopped ? { ok: true } : { error: "运行任务不存在或已经结束" },
        origin,
      );
      return;
    }

    sendJson(response, 404, { error: "Not found" }, origin);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, { error: error.message || "本地运行服务异常" }, origin);
    } else if (!response.destroyed) {
      response.end(
        `${JSON.stringify({
          type: "run.error",
          source: "runtime",
          message: error.message || "本地运行服务异常",
        })}\n`,
      );
    }
  }
});

server.listen(port, host, () => {
  const boundPort = server.address()?.port ?? port;
  console.log(`Advisor Atlas runtime: http://${hostForUrl}:${boundPort}`);
  console.log(`Project root: ${projectRoot}`);
});

function shutdown() {
  for (const runId of activeRuns.keys()) terminateRun(runId);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

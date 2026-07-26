import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createProjectStore } from "./project-store.mjs";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(runtimeDirectory, "../..");
const dataRoot = resolve(projectRoot, ".advisor-atlas");
const host = "127.0.0.1";
const port = Number(process.env.ADVISOR_ATLAS_RUNTIME_PORT || 4318);
const activeRuns = new Map();
const projectStore = createProjectStore(projectRoot);
const bundledCodexPath = "/Applications/ChatGPT.app/Contents/Resources/codex";
const codexExecutable =
  process.env.ADVISOR_ATLAS_CODEX_BIN ||
  (existsSync(bundledCodexPath) ? bundledCodexPath : "codex");
const customProviderMetadataPath = resolve(dataRoot, "custom-provider.json");
let customProviderSession = null;

await mkdir(dataRoot, { recursive: true });
await projectStore.ensureDefaultProject();

function corsHeaders(origin) {
  let allowedOrigin = "http://localhost:3000";
  try {
    const parsed = new URL(origin || allowedOrigin);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
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
    execText(codexExecutable, ["--version"]),
    execText(codexExecutable, ["login", "status"]),
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
        installed: true,
        loggedIn: Boolean(customProviderSession),
        version: customProviderSession?.model || null,
        authDetail: customProviderSession
          ? `已连接 ${customProviderSession.name}`
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
  if (
    provider !== "claude" &&
    stream === "stderr" &&
    /Reading additional input from stdin|codex_core_plugins::manifest|codex_core_skills::loader|failed to load models cache|failed to renew cache TTL|Unknown model .*fallback model metadata|model personality requested/.test(
      line,
    )
  ) {
    return {
      type: "diagnostic",
      source: provider,
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
    if (parsed.type === "thread.started") {
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
    message,
    raw: parsed,
  };
}

function terminateRun(runId) {
  const run = activeRuns.get(runId);
  if (!run || run.finished) return false;
  run.stopped = true;

  try {
    if (process.platform !== "win32" && run.child.pid) {
      process.kill(-run.child.pid, "SIGTERM");
    } else {
      run.child.kill("SIGTERM");
    }
  } catch {
    run.child.kill("SIGTERM");
  }

  setTimeout(() => {
    if (run.child.exitCode === null) {
      try {
        if (process.platform !== "win32" && run.child.pid) {
          process.kill(-run.child.pid, "SIGKILL");
        } else {
          run.child.kill("SIGKILL");
        }
      } catch {
        // The process has already exited.
      }
    }
  }, 2500).unref();
  return true;
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
  if (!prompt || prompt.length > 60_000) {
    sendJson(response, 400, { error: "请输入有效任务指令（最多 60,000 字）" }, origin);
    return;
  }
  const project = await projectStore.getProject(projectId);
  if (!project.readiness.ready) {
    sendJson(
      response,
      422,
      {
        error: `开始寻找导师前，请先完成：${project.readiness.missing.join("、")}`,
        missingInputs: project.readiness.missing,
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
5. 不得编造 CV、导师、招生状态或申请者经历；缺少必要输入时明确列出缺失项并停止等待。
6. 每完成一个阶段，都要把真实进度同步到 ${resolve(project.path, "status.json")}。保留 JSON 格式，并只使用这组字段：
   {"phase":"intake|finder|detective|evaluator|completed","candidateCount":0,"highMatchCount":0,"evidenceCount":0,"evidenceCoverage":0,"rankingCount":0,"updatedAt":"ISO-8601 时间"}
   数字必须来自该项目实际产物；尚未产生的结果保持 0，不能用界面演示数字填充。
7. Phase 1 产生候选后，同步写入 ${resolve(project.path, "outputs", "candidates.json")}。该文件是 JSON 数组，每项只使用：
   {"rank":1,"initials":"AB","name":"真实姓名","school":"真实院校","fit":0.0,"status":"已核实状态或待核实","statusTone":"open|caution|unknown","directions":["方向"],"evidence":0}
   每项必须可追溯到真实检索结果；不确定字段要标为待核实，不能补写演示人物。
8. 不要执行 git commit、git push、发布、发送邮件或任何对外提交操作。`;

  const command =
    provider === "codex"
      ? {
          executable: codexExecutable,
          args: [
            "exec",
            "--json",
            "--sandbox",
            "workspace-write",
            "-C",
            project.path,
            "--skip-git-repo-check",
            effectivePrompt,
          ],
        }
      : provider === "claude"
        ? {
            executable: "claude",
            args: [
              "-p",
              effectivePrompt,
              "--output-format",
              "stream-json",
              "--verbose",
              "--permission-mode",
              "auto",
              "--setting-sources",
              "user,project,local",
            ],
          }
        : {
            executable: codexExecutable,
            args: [
              "exec",
              "--json",
              "--sandbox",
              "workspace-write",
              "-C",
              project.path,
              "--skip-git-repo-check",
              "--model",
              customProviderSession.model,
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
              effectivePrompt,
            ],
          };

  const metadata = {
    id: runId,
    projectId: project.id,
    provider,
    status: "running",
    prompt,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    outputDirectory: runDirectory,
  };
  await writeFile(
    resolve(runDirectory, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
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

  const emit = (event) => {
    const line = `${JSON.stringify({ runId, at: new Date().toISOString(), ...event })}\n`;
    eventLog.write(line);
    if (!response.destroyed) response.write(line);
  };

  emit({
    type: "run.started",
    source: "runtime",
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
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const run = {
    id: runId,
    child,
    response,
    metadata,
    eventLog,
    finished: false,
    stopped: false,
  };
  activeRuns.set(runId, run);

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
        const event = normalizeEvent(provider, line, streamName);
        if (event.message || streamName === "stderr") emit(event);
      }
    });
    stream.on("end", () => {
      if (pending.trim()) emit(normalizeEvent(provider, pending, streamName));
    });
  }

  child.on("error", async (error) => {
    emit({
      type: "run.error",
      source: "runtime",
      message: error.message,
    });
  });

  child.on("close", async (code, signal) => {
    run.finished = true;
    metadata.status = run.stopped ? "stopped" : code === 0 ? "completed" : "failed";
    metadata.finishedAt = new Date().toISOString();
    metadata.exitCode = code;
    metadata.signal = signal;
    await writeFile(
      resolve(runDirectory, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    emit({
      type: "run.finished",
      source: "runtime",
      message:
        metadata.status === "completed"
          ? "本地任务已完成"
          : metadata.status === "stopped"
            ? "本地任务已停止"
            : `本地任务异常结束（退出码 ${code ?? "unknown"}）`,
      status: metadata.status,
      exitCode: code,
    });
    eventLog.end();
    if (!response.destroyed) response.end();
    activeRuns.delete(runId);
  });
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);

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
          active: [...activeRuns.values()]
            .map((run) => run.metadata)
            .filter((run) => run.projectId === projectId),
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
      const fileId = randomUUID();
      const buffer = await readBuffer(request);
      if (!buffer.length) {
        sendJson(response, 400, { error: "文件内容为空" }, origin);
        return;
      }
      const filePath = resolve(project.path, "inputs", `${fileId}-${fileName}`);
      await writeFile(filePath, buffer);
      const updatedProject = await projectStore.setProjectCv(projectId, {
        name: fileName,
        path: filePath,
        size: buffer.length,
        type: request.headers["x-file-type"] || "application/octet-stream",
      });
      sendJson(
        response,
        201,
        {
          id: fileId,
          name: fileName,
          size: buffer.length,
          type: request.headers["x-file-type"] || "application/octet-stream",
          path: filePath,
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
  console.log(`Advisor Atlas runtime: http://${host}:${port}`);
  console.log(`Project root: ${projectRoot}`);
});

function shutdown() {
  for (const runId of activeRuns.keys()) terminateRun(runId);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const baseUrl = process.env.ADVISOR_ATLAS_RUNTIME_URL || "http://127.0.0.1:4318";
const [command = "help", ...args] = process.argv.slice(2);

function value(flag, fallback = "") {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.message || "请求失败");
  return payload;
}

function printHelp() {
  console.log(`Advisor Atlas 后端命令

先启动后端：
  npm run runtime

命令：
  npm run backend -- health
  npm run backend -- projects
  npm run backend -- create --name "我的博士申请"
  npm run backend -- update --project my-phd-application --season "2028 Fall" --degree PhD --target "美国 HCI/AI 项目" --interests "Human-AI:60,AI4Health:40"
  npm run backend -- upload --project my-phd-application --file "/absolute/path/CV.pdf"
  npm run backend -- run --project my-phd-application --provider codex --prompt "使用 advisor-pipeline 开始导师匹配"

provider 可选：codex、claude、custom
`);
}

try {
  if (command === "health") {
    console.log(JSON.stringify(await jsonRequest("/api/health"), null, 2));
  } else if (command === "projects") {
    console.log(JSON.stringify(await jsonRequest("/api/projects"), null, 2));
  } else if (command === "create") {
    const payload = {
      name: value("--name"),
      slug: value("--slug"),
      season: value("--season"),
      degree: value("--degree"),
      target: value("--target"),
    };
    if (!payload.name) {
      throw new Error("create 需要 --name；文件夹 ID 会自动生成");
    }
    console.log(
      JSON.stringify(
        await jsonRequest("/api/projects", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
        null,
        2,
      ),
    );
  } else if (command === "update") {
    const projectId = value("--project");
    if (!projectId) throw new Error("update 需要 --project");
    const interests = value("--interests")
      .split(",")
      .map((item) => {
        const separator = item.lastIndexOf(":");
        return {
          name: separator >= 0 ? item.slice(0, separator).trim() : "",
          weight: separator >= 0 ? Number(item.slice(separator + 1)) : 0,
        };
      })
      .filter((item) => item.name && item.weight > 0);
    const payload = {
      ...(value("--name") ? { name: value("--name") } : {}),
      ...(value("--season") ? { season: value("--season") } : {}),
      ...(value("--degree") ? { degree: value("--degree") } : {}),
      ...(value("--target") ? { target: value("--target") } : {}),
      ...(value("--interests") ? { interests } : {}),
    };
    console.log(
      JSON.stringify(
        await jsonRequest(`/api/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),
        null,
        2,
      ),
    );
  } else if (command === "upload") {
    const projectId = value("--project");
    const filePath = resolve(value("--file"));
    if (!projectId || !value("--file")) {
      throw new Error("upload 需要 --project 和 --file");
    }
    const buffer = await readFile(filePath);
    const response = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: {
        "x-project-id": projectId,
        "x-file-name": encodeURIComponent(basename(filePath)),
        "x-file-type": "application/octet-stream",
      },
      body: buffer,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CV 上传失败");
    console.log(JSON.stringify(payload, null, 2));
  } else if (command === "run") {
    const projectId = value("--project");
    const provider = value("--provider", "codex");
    const prompt = value("--prompt");
    if (!projectId || !prompt) {
      throw new Error("run 需要 --project 和 --prompt");
    }
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, provider, prompt }),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "任务启动失败");
    }
    if (!response.body) throw new Error("后端没有返回事件流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.message) {
          console.log(`[${event.source}] ${event.message}`);
        }
      }
    }
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
}

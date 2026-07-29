import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the advisor console", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Advisor Atlas · 导师匹配控制台<\/title>/i);
  assert.match(html, /导师匹配进度/);
  assert.match(html, /优先候选导师/);
  assert.match(html, /本地项目 · 文件本地保存/);
  assert.match(html, /选择引擎 · Phase 1 0\/2/);
  assert.match(html, /Phase 1 希望保留的导师数/);
  assert.match(html, /研究兴趣与权重/);
  assert.match(html, /可选/);
  assert.match(html, /选择需要调查的信息/);
  assert.match(html, /前三项是默认背调起点/);
  assert.match(html, /导师社区资料/);
  assert.match(html, /客观申请可行性/);
  assert.match(html, /命令、文件或网络权限会在运行面板确认/);
  assert.doesNotMatch(html, /默认信息收集范围/);
  assert.doesNotMatch(html, /SHALLOW|MEDIUM|HIGH/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

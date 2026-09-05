import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("the run actions stay outside the scrolling drawer body", () => {
  assert.match(
    pageSource,
    /<div className="runner-scroll-body">[\s\S]*<\/div>\s*<footer className="runner-footer">/,
  );
  assert.match(cssSource, /\.runner-scroll-body\s*\{[\s\S]*overflow-y: auto/);
  assert.match(cssSource, /\.runner-footer\s*\{[\s\S]*flex: none/);
});

test("refresh status has visible pending and completion feedback", () => {
  assert.match(pageSource, /aria-busy=\{runtimeRefreshing\}/);
  assert.match(pageSource, /runtimeRefreshing \? "正在刷新…" : "刷新状态"/);
  assert.match(pageSource, /showNotice\("模型连接状态已刷新"\)/);
  assert.match(cssSource, /\.toast\s*\{[\s\S]*z-index: 80/);
});

test("reselecting a project no longer clears its saved CV presentation", () => {
  const selectProject = pageSource.match(
    /function selectProject\([\s\S]*?\n  }\n\n  function hideProject/,
  )?.[0] || "";
  assert.ok(selectProject);
  assert.doesNotMatch(selectProject, /setFileName|setFilePath|setUploadState/);
  assert.match(pageSource, /setFileName\(activeProject\.cv\?\.name/);
});

test("saved projects open their latest result and completed candidates can rerun", () => {
  assert.match(pageSource, /selectProject\(item\.id, latestProjectView\(item\)\)/);
  assert.match(pageSource, /candidates\.length > 0[\s\S]*重新匹配/);
});

test("candidate results separate research, profile, and overall matching", () => {
  assert.match(pageSource, /<th scope="col">研究匹配<\/th>/);
  assert.match(pageSource, /<th scope="col">履历匹配<\/th>/);
  assert.match(pageSource, /<th scope="col">综合匹配<\/th>/);
  assert.match(pageSource, /candidate\.profileMatch \?\? "—"/);
  assert.match(pageSource, /candidate\.overallMatch \?\? "—"/);
  assert.match(pageSource, /verify_constraints: "先核实硬条件"/);
  assert.match(pageSource, /verify_eligibility: "先核实申请资格"/);
});

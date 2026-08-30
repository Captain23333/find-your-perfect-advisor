import assert from "node:assert/strict";
import test from "node:test";
import { appendVisibleRunEvent } from "../app/run-event-state.mjs";

test("repeated connection warnings collapse without hiding real progress", () => {
  let events = [];
  events = appendVisibleRunEvent(events, {
    type: "connection.retry",
    source: "runtime",
    message: "重试 1",
  });
  events = appendVisibleRunEvent(events, {
    type: "run.started",
    source: "codex",
    message: "开始处理",
  });
  events = appendVisibleRunEvent(events, {
    type: "connection.retry",
    source: "runtime",
    message: "重试 5",
  });

  assert.equal(events.filter((event) => event.type === "connection.retry").length, 1);
  assert.equal(events.find((event) => event.type === "connection.retry").message, "重试 5");
  assert.ok(events.some((event) => event.message === "开始处理"));
});

test("adjacent agent deltas still render as one message", () => {
  let events = [];
  events = appendVisibleRunEvent(events, {
    type: "item/agentMessage/delta",
    source: "codex",
    message: "Hello ",
  });
  events = appendVisibleRunEvent(events, {
    type: "item/agentMessage/delta",
    source: "codex",
    message: "world",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].message, "Hello world");
});

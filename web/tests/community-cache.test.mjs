import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  clearCommunityCache,
  getCommunityCacheStatus,
  syncCommunityCache,
} from "../local-runtime/community-cache.mjs";

test("oversized source leaves cache explicitly unsearchable", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "advisor-atlas-cache-"));
  try {
    const missing = await getCommunityCacheStatus(project);
    assert.equal(missing.state, "missing");

    const result = await syncCommunityCache(project, {
      maxBytes: 4,
      fetchImpl: async () =>
        new Response("12345", {
          status: 200,
          headers: { "content-length": "5", "content-type": "application/pdf" },
        }),
    });
    assert.equal(result.searchReady, false);
    assert.match(result.error, /上限/);

    const status = await getCommunityCacheStatus(project);
    assert.equal(status.state, "unsearchable");
    assert.equal(status.searchReady, false);

    const cleared = await clearCommunityCache(project);
    assert.ok(cleared.removed.includes("community-knowledge-metadata.json"));
    assert.equal((await getCommunityCacheStatus(project)).state, "missing");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

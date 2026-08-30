import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createVinextLaunch } from "../scripts/vinext.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("vinext launch uses Node directly without a platform-specific shell", () => {
  const launch = createVinextLaunch(["dev", "--port", "3001"], {
    webRoot,
    env: { TEST_VALUE: "preserved" },
    nodePath: "node-from-current-platform",
    stdio: "pipe",
  });

  assert.equal(launch.command, "node-from-current-platform");
  assert.match(launch.args[0], /node_modules[\\/]vinext[\\/]dist[\\/]cli\.js$/);
  assert.deepEqual(launch.args.slice(1), ["dev", "--port", "3001"]);
  assert.equal(launch.options.env.TEST_VALUE, "preserved");
  assert.equal(
    launch.options.env.WRANGLER_LOG_PATH,
    ".wrangler/wrangler.log",
  );
  assert.equal(launch.options.shell, undefined);
});

test("npm scripts contain no POSIX-only environment assignment", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(webRoot, "package.json"), "utf8"),
  );

  for (const name of ["dev", "dev:ui", "build", "start", "test:startup"]) {
    assert.doesNotMatch(packageJson.scripts[name], /(?:^|\s)[A-Z_][A-Z0-9_]*=/);
  }
  assert.equal(packageJson.scripts["dev:ui"], "node scripts/vinext.mjs dev");
  assert.equal(packageJson.scripts.build, "node scripts/vinext.mjs build");
  assert.equal(packageJson.scripts.start, "node scripts/vinext.mjs start");
});

test("combined dev launcher does not spawn npm or a command shell", async () => {
  const source = await readFile(resolve(webRoot, "scripts", "dev-local.mjs"), "utf8");
  assert.doesNotMatch(source, /launch\(["']npm(?:\.cmd)?["']/);
  assert.doesNotMatch(source, /launch\(["']cmd\.exe["']/i);
  assert.match(source, /createVinextLaunch/);
});

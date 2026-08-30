import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVinextLaunch } from "./vinext.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function launch(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Failed to start ${name}: ${error.message}`);
    if (!shuttingDown) shutdown(1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1200).unref();
}

const runtime = launch("local runtime", process.execPath, [
  "local-runtime/server.mjs",
]);
const uiLaunch = createVinextLaunch(["dev", ...process.argv.slice(2)], {
  webRoot,
});
const ui = launch(
  "web UI",
  uiLaunch.command,
  uiLaunch.args,
  uiLaunch.options,
);

runtime.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
ui.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

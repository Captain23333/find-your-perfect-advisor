import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function launch(command, args) {
  const child = spawn(command, args, {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

const runtime = launch(process.execPath, ["local-runtime/server.mjs"]);
const ui = launch("npm", ["run", "dev:ui"]);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1200).unref();
}

runtime.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
ui.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

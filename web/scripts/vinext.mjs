import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultWebRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createVinextLaunch(
  args,
  {
    webRoot = defaultWebRoot,
    env = process.env,
    nodePath = process.execPath,
    stdio = "inherit",
  } = {},
) {
  return {
    command: nodePath,
    args: [resolve(webRoot, "node_modules", "vinext", "dist", "cli.js"), ...args],
    options: {
      cwd: webRoot,
      env: {
        ...env,
        WRANGLER_LOG_PATH:
          env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
      },
      stdio,
    },
  };
}

export function runVinext(args = process.argv.slice(2)) {
  if (args.length === 0) {
    console.error("Usage: node scripts/vinext.mjs <dev|build|start> [...args]");
    process.exitCode = 1;
    return null;
  }

  const launch = createVinextLaunch(args);
  if (!existsSync(launch.args[0])) {
    console.error("vinext is not installed. Run `npm install` in the web directory.");
    process.exitCode = 1;
    return null;
  }

  const child = spawn(launch.command, launch.args, launch.options);
  child.on("error", (error) => {
    console.error(`Failed to start vinext: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (child.exitCode === null) child.kill(signal);
    });
  }

  return child;
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedUrl === import.meta.url) runVinext();

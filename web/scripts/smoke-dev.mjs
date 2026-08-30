import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitFor(url, child, output, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "service did not respond";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited with ${child.exitCode}\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}\n${output()}`);
}

function stopProcessTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

const [runtimePort, uiPort] = await Promise.all([
  availablePort(),
  availablePort(),
]);
const chunks = [];
const child = spawn(
  process.execPath,
  ["scripts/dev-local.mjs", "--host", "127.0.0.1", "--port", String(uiPort)],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      ADVISOR_ATLAS_RUNTIME_PORT: String(runtimePort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (chunk) => chunks.push(chunk.toString()));
child.stderr.on("data", (chunk) => chunks.push(chunk.toString()));

try {
  const output = () => chunks.join("").slice(-12_000);
  await Promise.all([
    waitFor(`http://127.0.0.1:${runtimePort}/api/health`, child, output),
    waitFor(`http://localhost:${uiPort}/`, child, output),
  ]);
  console.log("Windows-safe dev launcher smoke test passed.");
} finally {
  stopProcessTree(child);
}

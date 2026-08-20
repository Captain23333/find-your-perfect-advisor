import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const LOCK_DIRECTORY = ".advisor-atlas-project.lock";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function staleLockCanBeRemoved(lockPath, staleAfterMs) {
  try {
    const [details, owner] = await Promise.all([
      stat(lockPath),
      readFile(resolve(lockPath, "owner.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null),
    ]);
    if (owner?.pid && processIsAlive(Number(owner.pid))) return false;
    return Date.now() - details.mtimeMs >= staleAfterMs || Boolean(owner?.pid);
  } catch (error) {
    return error.code === "ENOENT";
  }
}

export async function withProjectFileLock(
  projectRoot,
  task,
  { timeoutMs = 15_000, staleAfterMs = 30_000 } = {},
) {
  const root = resolve(projectRoot);
  const lockPath = resolve(root, LOCK_DIRECTORY);
  const startedAt = Date.now();
  await mkdir(root, { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        resolve(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
      );
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await staleLockCanBeRemoved(lockPath, staleAfterMs)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const timeoutError = new Error(
          "项目正在被另一个 Web 或 CLI 操作修改，请稍后重试",
        );
        timeoutError.code = "PROJECT_LOCK_TIMEOUT";
        throw timeoutError;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}

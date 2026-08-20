import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const RUN_EVENT_BUFFER_LIMIT = 800;

// One agent per project. A global cap alone let two agents write the same
// status.json and outputs/ directory at the same time.
export function createRunRegistry() {
  const runsById = new Map();
  const runIdByProject = new Map();

  function get(runId) {
    return runsById.get(runId) || null;
  }

  function activeForProject(projectId) {
    const runId = runIdByProject.get(projectId);
    if (!runId) return null;
    const run = runsById.get(runId);
    if (!run || run.finished) {
      runIdByProject.delete(projectId);
      return null;
    }
    return run;
  }

  function register(run) {
    const projectId = run.metadata.projectId;
    const existing = activeForProject(projectId);
    if (existing) {
      const error = new Error("该申请项目已有任务正在运行，请先接入或取消它");
      error.code = "PROJECT_RUN_CONFLICT";
      error.activeRun = existing;
      throw error;
    }
    runsById.set(run.id, run);
    runIdByProject.set(projectId, run.id);
    return run;
  }

  function release(runId) {
    const run = runsById.get(runId);
    runsById.delete(runId);
    if (run && runIdByProject.get(run.metadata.projectId) === runId) {
      runIdByProject.delete(run.metadata.projectId);
    }
  }

  function activeList(projectId) {
    return [...runsById.values()].filter(
      (run) => !run.finished && run.metadata.projectId === projectId,
    );
  }

  return {
    get,
    register,
    release,
    activeForProject,
    activeList,
    get size() {
      return runsById.size;
    },
    keys: () => [...runsById.keys()],
    values: () => [...runsById.values()],
  };
}

export function runSnapshot(run) {
  return {
    ...run.metadata,
    pendingPermissions: [...(run.permissions?.values() || [])].map(
      (pending) => pending.permission,
    ),
  };
}

export function appendToBuffer(buffer, line, limit = RUN_EVENT_BUFFER_LIMIT) {
  buffer.push(line);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
  return buffer;
}

// A run only exists inside the runtime process. Anything still marked `running`
// in a project folder belongs to a runtime that died, so it must not keep
// showing as active forever.
export async function markOrphanedRunsInterrupted(projectStore, now = new Date().toISOString()) {
  const interrupted = [];
  let projects = [];
  try {
    projects = await projectStore.listProjects();
  } catch {
    return interrupted;
  }
  for (const project of projects) {
    const runsRoot = resolve(project.path, "runs");
    let entries = [];
    try {
      entries = await readdir(runsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadataPath = resolve(runsRoot, entry.name, "metadata.json");
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        if (!["running", "needs_input"].includes(metadata.status)) continue;
        metadata.status = "interrupted";
        metadata.finishedAt = now;
        metadata.interruptedReason = "本地运行服务在任务结束前重启";
        await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
        interrupted.push(metadata.id || entry.name);
      } catch {
        // Ignore incomplete run folders.
      }
    }
  }
  return interrupted;
}

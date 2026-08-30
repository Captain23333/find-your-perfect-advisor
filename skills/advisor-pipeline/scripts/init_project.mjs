#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  STRUCTURED_OUTPUT_FILES,
  createStatus,
  normalizeProjectMetadata,
  normalizeStatus,
  validateProjectMetadata,
} from "./project-contract.mjs";
import { withProjectFileLock } from "./project-file-lock.mjs";
import { isExecutedDirectly } from "./direct-execution.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function pathType(path) {
  try {
    const details = await stat(path);
    if (details.isDirectory()) return "directory";
    if (details.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function localProjectId(root) {
  const readable = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (readable.length >= 3) return readable;
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 10);
  return `local-project-${suffix}`;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${basename(path)} 不是合法 JSON：${error.message}`);
  }
}

async function initializeProjectDirectoryUnlocked(
  root,
  { checkOnly = false, now = new Date().toISOString() } = {},
) {
  const projectRoot = resolve(root);
  const projectFile = resolve(projectRoot, "project.json");
  const statusFile = resolve(projectRoot, "status.json");
  const outputRoot = resolve(projectRoot, "outputs");
  const id = localProjectId(projectRoot);
  const changes = [];
  const backups = [];

  const projectExists = await exists(projectFile);
  const rawProject = projectExists ? await readJson(projectFile) : {};
  let legacyDetectiveResults = null;
  const detectiveResultsFile = resolve(outputRoot, "detective-results.json");
  if (Number(rawProject.schemaVersion || 0) < 4 && (await exists(detectiveResultsFile))) {
    try {
      legacyDetectiveResults = await readJson(detectiveResultsFile);
    } catch {
      // A malformed optional result cannot prove historical confirmation.
    }
  }
  const normalizedProject = normalizeProjectMetadata(rawProject, {
    fallbackId: id,
    now,
    legacyDetectiveResults,
  });
  const rawValidation = validateProjectMetadata(rawProject);
  const projectChanged =
    !projectExists ||
    JSON.stringify(rawProject) !== JSON.stringify(normalizedProject);

  const statusExists = await exists(statusFile);
  const rawStatus = statusExists ? await readJson(statusFile) : {};
  const normalizedStatus = statusExists ? normalizeStatus(rawStatus, now) : createStatus(now);
  const statusChanged =
    !statusExists || JSON.stringify(rawStatus) !== JSON.stringify(normalizedStatus);
  const requiredDirectories = [
    resolve(projectRoot, "inputs"),
    outputRoot,
    resolve(projectRoot, "runs"),
  ];
  const missingDirectories = [];
  const structureErrors = [];
  for (const directory of requiredDirectories) {
    const type = await pathType(directory);
    if (type === "missing") missingDirectories.push(directory);
    else if (type !== "directory") {
      structureErrors.push(`${directory} 必须是目录，当前类型为 ${type}`);
    }
  }
  const missingOutputs = [];
  for (const file of STRUCTURED_OUTPUT_FILES) {
    const output = resolve(outputRoot, file);
    const type = await pathType(output);
    if (type === "missing") {
      missingOutputs.push(output);
      continue;
    }
    if (type !== "file") {
      structureErrors.push(`${output} 必须是普通 JSON 文件，当前类型为 ${type}`);
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(output, "utf8"));
      if (!Array.isArray(parsed)) {
        structureErrors.push(`${output} 顶层必须是 JSON 数组`);
      }
    } catch (error) {
      structureErrors.push(`${output} 不是合法 JSON：${error.message}`);
    }
  }

  if (!checkOnly) {
    if (structureErrors.length) {
      throw new Error(`项目结构无效：\n- ${structureErrors.join("\n- ")}`);
    }
    await mkdir(projectRoot, { recursive: true });
    await Promise.all([
      mkdir(resolve(projectRoot, "inputs"), { recursive: true }),
      mkdir(outputRoot, { recursive: true }),
      mkdir(resolve(projectRoot, "runs"), { recursive: true }),
    ]);
    if (projectExists && projectChanged) {
      const backup = resolve(projectRoot, `project.json.backup-${now.replace(/[:.]/g, "-")}`);
      await copyFile(projectFile, backup);
      backups.push(backup);
    }
    if (statusExists && statusChanged) {
      const backup = resolve(projectRoot, `status.json.backup-${now.replace(/[:.]/g, "-")}`);
      await copyFile(statusFile, backup);
      backups.push(backup);
    }
    if (projectChanged) {
      await writeJsonAtomic(projectFile, normalizedProject);
      changes.push(projectExists ? "migrated project.json" : "created project.json");
    }
    if (statusChanged) {
      await writeJsonAtomic(statusFile, normalizedStatus);
      changes.push(statusExists ? "migrated status.json" : "created status.json");
    }
    for (const file of STRUCTURED_OUTPUT_FILES) {
      const output = resolve(outputRoot, file);
      if (!(await exists(output))) {
        try {
          await writeFile(output, "[]\n", { flag: "wx" });
          changes.push(`created outputs/${file}`);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    }
  }

  return {
    root: projectRoot,
    valid:
      validateProjectMetadata(normalizedProject).valid && structureErrors.length === 0,
    requiresMigration:
      projectChanged ||
      statusChanged ||
      missingDirectories.length > 0 ||
      missingOutputs.length > 0 ||
      structureErrors.length > 0,
    originalErrors: rawValidation.errors,
    missingDirectories,
    missingOutputs,
    structureErrors,
    changes,
    backups,
    project: normalizedProject,
    status: normalizedStatus,
  };
}

export async function initializeProjectDirectory(
  root,
  options = {},
) {
  const projectRoot = resolve(root);
  if (options.checkOnly) {
    return initializeProjectDirectoryUnlocked(projectRoot, options);
  }
  return withProjectFileLock(projectRoot, () =>
    initializeProjectDirectoryUnlocked(projectRoot, options),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  if (rootIndex >= 0 && !root) throw new Error("--root 后必须提供项目目录");
  const result = await initializeProjectDirectory(root, {
    checkOnly: args.includes("--check"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.includes("--check") && result.requiresMigration) process.exitCode = 1;
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

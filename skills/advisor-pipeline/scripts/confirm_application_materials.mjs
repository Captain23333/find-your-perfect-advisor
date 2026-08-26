#!/usr/bin/env node
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  confirmApplicationMaterialsDraft,
  normalizeProjectMetadata,
  updateApplicationMaterialsDraft,
  validateApplicationMaterialsDraft,
} from "./project-contract.mjs";
import { withProjectFileLock } from "./project-file-lock.mjs";

function option(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
}

function list(value) {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function confirmUnlocked(root, options) {
  const projectRoot = resolve(root);
  const projectFile = resolve(projectRoot, "project.json");
  const rankingFile = resolve(projectRoot, "outputs", "ranking.json");
  const [rawProject, rawRanking] = await Promise.all([
    readFile(projectFile, "utf8").then(JSON.parse),
    readFile(rankingFile, "utf8").then(JSON.parse),
  ]);
  const rankings = Array.isArray(rawRanking)
    ? rawRanking
    : Array.isArray(rawRanking?.rankings)
      ? rawRanking.rankings
      : Array.isArray(rawRanking?.ranking)
        ? rawRanking.ranking
        : [];
  const now = options.now || new Date().toISOString();
  const metadata = normalizeProjectMetadata(rawProject, {
    fallbackId: rawProject.id || rawProject.slug || "local-project",
    now,
  });
  const applicationMaterials = updateApplicationMaterialsDraft(
    metadata.applicationMaterials,
    {
      advisorProgramId: options.advisorProgramId,
      materials: options.materials,
      order: options.order,
    },
    now,
  );
  const validation = validateApplicationMaterialsDraft(applicationMaterials, rankings);
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  const confirmed = confirmApplicationMaterialsDraft(applicationMaterials, {
    expectedRevision: applicationMaterials.draft.revision,
    now,
  });
  const updated = {
    ...metadata,
    applicationMaterials: confirmed,
    updatedAt: now,
  };
  const backup = resolve(projectRoot, `project.json.backup-${now.replace(/[:.]/g, "-")}`);
  await copyFile(projectFile, backup);
  await writeJsonAtomic(projectFile, updated);
  return { project: updated, backup };
}

export async function confirmApplicationMaterialsInProject(root, options) {
  const projectRoot = resolve(root);
  return withProjectFileLock(projectRoot, () => confirmUnlocked(projectRoot, options));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--confirmed-by-user")) {
    throw new Error("缺少 --confirmed-by-user：必须先展示最终摘要并得到明确确认");
  }
  const root = option(args, "--root") || process.cwd();
  const advisorProgramId = option(args, "--advisor-id");
  const materials = list(option(args, "--materials"));
  const order = list(option(args, "--order"));
  const result = await confirmApplicationMaterialsInProject(root, {
    advisorProgramId,
    materials,
    order,
  });
  process.stdout.write(`${JSON.stringify({
    confirmed: result.project.applicationMaterials.confirmed,
    backup: result.backup,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

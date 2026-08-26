#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isSafeAdvisorProgramId } from "./project-contract.mjs";

function option(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
}

function inside(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  return absolutePath.startsWith(`${absoluteRoot}${sep}`);
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!isSafeAdvisorProgramId(id)) {
    throw new Error("--advisor-id 不是安全的 advisorProgramId");
  }
  return id;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function run(command, args, cwd) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) accept();
      else reject(new Error(`${command} 构建失败，退出码 ${code}`));
    });
  });
}

export async function buildResearchProposal({
  root,
  advisorProgramId,
  confirmedRevision,
  confirmedFingerprint,
  now = new Date().toISOString(),
}) {
  const projectRoot = resolve(root);
  const targetRoot = resolve(
    projectRoot,
    "outputs",
    "application-materials",
    safeId(advisorProgramId),
  );
  if (!inside(projectRoot, targetRoot)) throw new Error("RP 输出目录越界");
  const texPath = resolve(targetRoot, "research-proposal.tex");
  const bibPath = resolve(targetRoot, "references.bib");
  const [texBytes, bibBytes] = await Promise.all([readFile(texPath), readFile(bibPath)]);
  const buildRoot = resolve(targetRoot, "build");
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(buildRoot, { recursive: true });
  await run(
    "latexmk",
    [
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-outdir=${buildRoot}`,
      "research-proposal.tex",
    ],
    targetRoot,
  );
  const builtPdfPath = resolve(buildRoot, "research-proposal.pdf");
  const pdfBytes = await readFile(builtPdfPath);
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("LaTeX 构建没有产生有效 PDF");
  }
  const pdfPath = resolve(targetRoot, "research-proposal.pdf");
  await copyFile(builtPdfPath, pdfPath);
  const build = {
    schemaVersion: 1,
    advisorProgramId,
    confirmedRevision,
    confirmedFingerprint,
    builtAt: now,
    engine: "latexmk-pdf-bibtex",
    texFile: "research-proposal.tex",
    bibFile: "references.bib",
    pdfFile: "research-proposal.pdf",
    texSha256: sha256(texBytes),
    bibSha256: sha256(bibBytes),
    pdfSha256: sha256(pdfBytes),
    pdfBytes: pdfBytes.length,
  };
  const buildPath = resolve(targetRoot, "proposal-build.json");
  const temporary = `${buildPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(build, null, 2)}\n`);
  await rename(temporary, buildPath);
  return { targetRoot, pdfPath, buildPath, build };
}

async function main() {
  const args = process.argv.slice(2);
  const root = option(args, "--root") || process.cwd();
  const advisorProgramId = option(args, "--advisor-id");
  const confirmedRevision = Number(option(args, "--confirmed-revision"));
  const confirmedFingerprint = option(args, "--confirmed-fingerprint");
  if (!advisorProgramId || !Number.isInteger(confirmedRevision) || !confirmedFingerprint) {
    throw new Error(
      "需要 --advisor-id、--confirmed-revision 和 --confirmed-fingerprint",
    );
  }
  const result = await buildResearchProposal({
    root,
    advisorProgramId,
    confirmedRevision,
    confirmedFingerprint,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

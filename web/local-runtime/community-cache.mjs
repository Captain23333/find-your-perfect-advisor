import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const CACHE_FILES = [
  "community-blacklist-current.pdf",
  "community-blacklist-current.txt",
  "community-red-flags-current.txt",
  "community-knowledge-metadata.json",
  "community-links.json",
];

const SOURCES = [
  {
    name: "community-blacklist-current.pdf",
    sourceUrl:
      "https://drive.google.com/file/d/1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h/view",
    downloadUrl:
      "https://drive.usercontent.google.com/download?id=1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h&export=download&confirm=t",
    kind: "pdf",
  },
  {
    name: "community-red-flags-current.txt",
    sourceUrl:
      "https://docs.google.com/document/d/1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/edit",
    downloadUrl:
      "https://docs.google.com/document/d/1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/export?format=txt",
    kind: "text",
  },
];

function cacheDirectory(projectPath) {
  return resolve(projectPath, "community-cache");
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function readResponseLimited(response, maxBytes = MAX_SOURCE_BYTES) {
  if (!response.ok) {
    throw new Error(`第三方来源下载失败（HTTP ${response.status}）`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error(`第三方来源超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`);
  }
  if (!response.body) throw new Error("第三方来源没有可读取内容");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`第三方来源超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function extractPdfText(data) {
  const document = await getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ");
      pages.push(`--- Page ${pageNumber} ---\n${text}`);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  const output = `${pages.join("\n\n")}\n`;
  if (!output.replace(/--- Page \d+ ---/g, "").trim()) {
    throw new Error("PDF 已下载，但没有提取出可搜索文本");
  }
  return output;
}

function extractLinks(namedTexts) {
  const rows = [];
  const seen = new Set();
  const pattern = /https?:\/\/[^\s<>"']+/g;
  for (const [sourceFile, text] of namedTexts) {
    for (const raw of text.match(pattern) || []) {
      const url = raw.replace(/[.,;:!?，。；、）)\]}]+$/u, "");
      const key = `${sourceFile}\n${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ source_file: sourceFile, url });
      }
    }
  }
  return rows;
}

export async function getCommunityCacheStatus(projectPath) {
  const directory = cacheDirectory(projectPath);
  try {
    const metadata = JSON.parse(
      await readFile(resolve(directory, "community-knowledge-metadata.json"), "utf8"),
    );
    return {
      state: metadata.searchReady ? "ready" : "unsearchable",
      directory,
      fetchedAt: metadata.fetchedAt || null,
      searchReady: Boolean(metadata.searchReady),
      sources: metadata.sources || [],
      error: metadata.error || null,
    };
  } catch {
    return {
      state: "missing",
      directory,
      fetchedAt: null,
      searchReady: false,
      sources: [],
      error: null,
    };
  }
}

export async function clearCommunityCache(projectPath) {
  const directory = cacheDirectory(projectPath);
  const removed = [];
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      (CACHE_FILES.includes(entry.name) || entry.name.endsWith(".tmp"))
    ) {
      await rm(resolve(directory, entry.name), { force: true });
      removed.push(entry.name);
    }
  }
  return { directory, removed: removed.sort() };
}

export async function syncCommunityCache(
  projectPath,
  { fetchImpl = fetch, maxBytes = MAX_SOURCE_BYTES } = {},
) {
  const directory = cacheDirectory(projectPath);
  await mkdir(directory, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const sourceRows = [];
  const namedTexts = [];

  try {
    for (const source of SOURCES) {
      const response = await fetchImpl(source.downloadUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
        headers: { "user-agent": "AdvisorAtlasKnowledgeSync/2.0" },
      });
      const data = await readResponseLimited(response, maxBytes);
      if (source.kind === "pdf" && !data.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new Error("黑榜来源返回的内容不是有效 PDF");
      }
      if (source.kind === "text" && data.length < 100) {
        throw new Error("红榜文本来源内容异常短");
      }

      const outputPath = resolve(directory, source.name);
      let previousSha256 = null;
      try {
        previousSha256 = sha256(await readFile(outputPath));
      } catch {
        // First refresh.
      }
      const currentSha256 = sha256(data);
      if (previousSha256 !== currentSha256) await atomicWrite(outputPath, data);

      const row = {
        name: source.name,
        sourceUrl: source.sourceUrl,
        bytes: data.length,
        sha256: currentSha256,
        previousSha256,
        changed: previousSha256 !== currentSha256,
        contentType: response.headers.get("content-type"),
        searchable: true,
      };

      if (source.kind === "pdf") {
        const text = await extractPdfText(data);
        const textName = "community-blacklist-current.txt";
        await atomicWrite(resolve(directory, textName), text);
        row.textExtract = textName;
        row.textExtractSha256 = sha256(text);
        row.extractor = "pdfjs-dist";
        namedTexts.push([textName, text]);
      } else {
        const text = data.toString("utf8").replace(/\r\n?/g, "\n");
        namedTexts.push([source.name, text]);
      }
      sourceRows.push(row);
    }

    const links = extractLinks(namedTexts);
    await atomicWrite(
      resolve(directory, "community-links.json"),
      `${JSON.stringify(links, null, 2)}\n`,
    );
    const metadata = {
      schemaVersion: 2,
      fetchedAt,
      searchReady: sourceRows.every((source) => source.searchable),
      sources: sourceRows,
      extractedLinkCount: links.length,
    };
    await atomicWrite(
      resolve(directory, "community-knowledge-metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    return {
      state: "ready",
      directory,
      fetchedAt,
      searchReady: true,
      sources: sourceRows,
      changedSources: sourceRows.filter((source) => source.changed).map((source) => source.name),
      extractedLinkCount: links.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区资料刷新失败";
    const metadata = {
      schemaVersion: 2,
      fetchedAt,
      searchReady: false,
      sources: sourceRows,
      error: message,
    };
    await atomicWrite(
      resolve(directory, "community-knowledge-metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    return {
      state: "unsearchable",
      directory,
      fetchedAt,
      searchReady: false,
      sources: sourceRows,
      changedSources: [],
      extractedLinkCount: 0,
      error: message,
    };
  }
}

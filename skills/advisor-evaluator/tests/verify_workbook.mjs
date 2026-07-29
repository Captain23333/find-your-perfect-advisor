#!/usr/bin/env node

import fs from "node:fs/promises";
import { basename, resolve } from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath, previewDirectory] = process.argv.slice(2);
if (!inputPath || !previewDirectory) {
  throw new Error("Usage: verify_workbook.mjs workbook.xlsx preview-directory");
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
if (/"matchCount":\s*[1-9]/.test(errors.ndjson)) {
  throw new Error(errors.ndjson);
}

await fs.mkdir(previewDirectory, { recursive: true });
const previews = [];
for (const sheet of workbook.worksheets.items) {
  const image = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  const output = resolve(
    previewDirectory,
    `${basename(inputPath)}-${sheet.name.replaceAll("/", "-")}.png`,
  );
  await fs.writeFile(output, new Uint8Array(await image.arrayBuffer()));
  previews.push(output);
}
console.log(JSON.stringify({ workbook: resolve(inputPath), previews, errors: 0 }));

import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";

const COLORS = {
  header: "FF4338A8",
  line: "FFDDD9EA",
  ink: "FF1F2937",
  white: "FFFFFFFF",
  green: "FFDCFCE7",
  amber: "FFFEF3C7",
  red: "FFFEE2E2",
};

const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;

export function formulaCell(formula, cachedValue = "") {
  return { kind: "formula", formula: String(formula), cachedValue };
}

export function dateCell(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return { kind: "date", value: date.toISOString() };
}

function isFormulaCell(value) {
  return value && typeof value === "object" && value.kind === "formula";
}

function isDateCell(value) {
  return value && typeof value === "object" && value.kind === "date";
}

function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "�")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function excelSerial(isoDate) {
  return new Date(isoDate).getTime() / 86_400_000 + 25_569;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, raw] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_FILE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_FILE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function contentTypes(sheetCount, tableCount) {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  const tables = Array.from({ length: tableCount }, (_, index) =>
    `<Override PartName="/xl/tables/table${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets}${tables}</Types>`;
}

function rootRelationships() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookXml(sheets) {
  const items = sheets
    .map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${items}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
}

function workbookRelationships(sheetCount) {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><color rgb="${COLORS.ink}"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="${COLORS.white}"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${COLORS.header}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="${COLORS.line}"/></bottom><diagonal/></border><border><left style="thin"><color rgb="${COLORS.header}"/></left><right style="thin"><color rgb="${COLORS.header}"/></right><top style="thin"><color rgb="${COLORS.header}"/></top><bottom style="thin"><color rgb="${COLORS.header}"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="3"><dxf><fill><patternFill patternType="solid"><fgColor rgb="${COLORS.green}"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="${COLORS.amber}"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="${COLORS.red}"/><bgColor indexed="64"/></patternFill></fill></dxf></dxfs></styleSheet>`;
}

function cellStyle(sheet, rowIndex, columnIndex, value) {
  if (rowIndex === 0) return 1;
  if (isDateCell(value)) return 5;
  const format = (sheet.numberFormats || []).find(
    (item) =>
      item.column === columnIndex &&
      rowIndex >= (item.startRow ?? 1) &&
      rowIndex <= (item.endRow ?? sheet.rows.length),
  )?.format;
  if (format === "0") return 3;
  if (format === "0.0") return 4;
  if (format === "yyyy-mm-dd hh:mm") return 5;
  return 2;
}

function cellXml(reference, value, style) {
  if (isFormulaCell(value)) {
    const formula = String(value.formula || "").replace(/^=/, "");
    const cached = value.cachedValue;
    const type = typeof cached === "string" ? ' t="str"' : "";
    return `<c r="${reference}" s="${style}"${type}><f>${xml(formula)}</f><v>${xml(cached)}</v></c>`;
  }
  if (isDateCell(value)) {
    return `<c r="${reference}" s="${style}"><v>${excelSerial(value.value)}</v></c>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const content = String(value ?? "");
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(content)}</t></is></c>`;
}

function worksheetXml(sheet, tableId) {
  const rows = [sheet.headers, ...(sheet.rows || [])];
  const columnCount = Math.max(sheet.headers.length, ...rows.map((row) => row.length));
  const lastCell = `${columnName(Math.max(0, columnCount - 1))}${Math.max(1, rows.length)}`;
  const columns = (sheet.widths || [])
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Number(width) || 12}" customWidth="1"/>`)
    .join("");
  const rowXml = rows
    .map((row, rowIndex) => {
      const explicitHeight = (sheet.rowHeights || []).find((item) => item.row === rowIndex)?.height;
      const height = explicitHeight || (rowIndex === 0 ? sheet.headerHeight || 34 : null);
      const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
        const value = row[columnIndex] ?? "";
        return cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value, cellStyle(sheet, rowIndex, columnIndex, value));
      }).join("");
      return `<row r="${rowIndex + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");
  const freezeRows = Math.max(0, Number(sheet.freezeRows ?? 1));
  const freezeColumns = Math.max(0, Number(sheet.freezeColumns ?? 2));
  const topLeftCell = `${columnName(freezeColumns)}${freezeRows + 1}`;
  const pane = freezeRows || freezeColumns
    ? `<pane${freezeColumns ? ` xSplit="${freezeColumns}"` : ""}${freezeRows ? ` ySplit="${freezeRows}"` : ""} topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/>`
    : "";
  const filterReference = `A1:${lastCell}`;
  const conditional = (sheet.conditionalFormats || [])
    .map((rule, index) => {
      const startRow = (rule.startRow ?? 1) + 1;
      const endRow = (rule.endRow ?? sheet.rows.length) + 1;
      const range = `${columnName(rule.column)}${startRow}:${columnName(rule.column)}${endRow}`;
      return `<conditionalFormatting sqref="${range}"><cfRule type="cellIs" dxfId="${rule.dxfId ?? index}" priority="${index + 1}" operator="equal"><formula>${xml(rule.formula)}</formula></cfRule></conditionalFormatting>`;
    })
    .join("");
  const hasTable = sheet.rows?.length > 0;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}<selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData>${hasTable ? `<autoFilter ref="${filterReference}"/>` : ""}${conditional}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${hasTable ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : ""}</worksheet>`;
}

function tableXml(sheet, tableId) {
  const lastColumn = columnName(Math.max(0, sheet.headers.length - 1));
  const lastRow = Math.max(1, sheet.rows.length + 1);
  const usedHeaders = new Map();
  const columns = sheet.headers
    .map((header, index) => {
      const base = String(header || `Column ${index + 1}`);
      const seen = usedHeaders.get(base) || 0;
      usedHeaders.set(base, seen + 1);
      const unique = seen ? `${base}_${seen + 1}` : base;
      return `<tableColumn id="${index + 1}" name="${xml(unique)}"/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${tableId}" name="AdvisorTable${tableId}" displayName="AdvisorTable${tableId}" ref="A1:${lastColumn}${lastRow}" totalsRowShown="0"><autoFilter ref="A1:${lastColumn}${lastRow}"/><tableColumns count="${sheet.headers.length}">${columns}</tableColumns><tableStyleInfo name="TableStyleMedium4" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

function sheetRelationships(tableId) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${tableId}.xml"/></Relationships>`;
}

function appProperties(sheetNames) {
  const titles = sheetNames.map((name) => `<vt:lpstr>${xml(name)}</vt:lpstr>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Advisor Atlas</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function coreProperties() {
  const timestamp = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Advisor Atlas</dc:creator><cp:lastModifiedBy>Advisor Atlas</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
}

export async function writePortableXlsx(spec, outputPath) {
  const sheets = Array.isArray(spec?.sheets) ? spec.sheets : [];
  if (!sheets.length) throw new Error("Workbook requires at least one sheet");
  const entries = [
    ["[Content_Types].xml", contentTypes(sheets.length, sheets.filter((sheet) => sheet.rows?.length).length)],
    ["_rels/.rels", rootRelationships()],
    ["docProps/app.xml", appProperties(sheets.map((sheet) => sheet.name))],
    ["docProps/core.xml", coreProperties()],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRelationships(sheets.length)],
    ["xl/styles.xml", stylesXml()],
  ];
  let tableId = 0;
  sheets.forEach((sheet, index) => {
    const hasTable = sheet.rows?.length > 0;
    if (hasTable) tableId += 1;
    entries.push([`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet, hasTable ? tableId : null)]);
    if (hasTable) {
      entries.push([`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, sheetRelationships(tableId)]);
      entries.push([`xl/tables/table${tableId}.xml`, tableXml(sheet, tableId)]);
    }
  });
  await fs.mkdir(dirname(resolve(outputPath)), { recursive: true });
  await fs.writeFile(resolve(outputPath), zipStored(entries));
  return { engine: "portable-ooxml", previews: [] };
}

function artifactValues(rows) {
  return rows.map((row) =>
    row.map((value) => {
      if (isFormulaCell(value)) return value.cachedValue ?? "";
      if (isDateCell(value)) return new Date(value.value);
      return value;
    }),
  );
}

async function writeWithArtifactTool(spec, outputPath, previewDir, artifactTool) {
  const { SpreadsheetFile, Workbook } = artifactTool;
  const workbook = Workbook.create();
  for (const sheetSpec of spec.sheets) {
    const sheet = workbook.worksheets.add(sheetSpec.name);
    sheet.showGridLines = false;
    sheet.getRangeByIndexes(0, 0, 1, sheetSpec.headers.length).values = [sheetSpec.headers];
    sheet.getRangeByIndexes(0, 0, 1, sheetSpec.headers.length).format = {
      fill: "#4338A8",
      font: { bold: true, color: "#FFFFFF" },
      wrapText: true,
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "outside", style: "thin", color: "#4338A8" },
    };
    sheet.getRangeByIndexes(0, 0, 1, sheetSpec.headers.length).format.rowHeight =
      sheetSpec.headerHeight || 34;
    if (sheetSpec.rows.length) {
      sheet.getRangeByIndexes(1, 0, sheetSpec.rows.length, sheetSpec.headers.length).values =
        artifactValues(sheetSpec.rows);
      sheet.getRangeByIndexes(1, 0, sheetSpec.rows.length, sheetSpec.headers.length).format = {
        font: { color: "#1F2937" },
        verticalAlignment: "top",
        wrapText: true,
        borders: {
          insideHorizontal: { style: "thin", color: "#DDD9EA" },
          bottom: { style: "thin", color: "#DDD9EA" },
        },
      };
      sheet.tables.add(
        sheet.getRangeByIndexes(0, 0, sheetSpec.rows.length + 1, sheetSpec.headers.length),
        true,
        `AdvisorTable${workbook.worksheets.items.length}`,
      );
    }
    sheet.freezePanes.freezeRows(sheetSpec.freezeRows ?? 1);
    sheet.freezePanes.freezeColumns(Math.min(sheetSpec.freezeColumns ?? 2, sheetSpec.headers.length));
    sheetSpec.widths.forEach((width, index) => {
      sheet.getRangeByIndexes(0, index, Math.max(sheetSpec.rows.length + 1, 1), 1).format.columnWidth = width;
    });
    for (const [rowIndex, row] of sheetSpec.rows.entries()) {
      for (const [columnIndex, value] of row.entries()) {
        const range = sheet.getRangeByIndexes(rowIndex + 1, columnIndex, 1, 1);
        if (isFormulaCell(value)) range.formulas = [[value.formula]];
        else if (isDateCell(value)) range.values = [[new Date(value.value)]];
      }
    }
    for (const format of sheetSpec.numberFormats || []) {
      const startRow = format.startRow ?? 1;
      const endRow = format.endRow ?? sheetSpec.rows.length;
      if (endRow >= startRow) {
        sheet.getRangeByIndexes(startRow, format.column, endRow - startRow + 1, 1).format.numberFormat = format.format;
      }
    }
    for (const height of sheetSpec.rowHeights || []) {
      sheet.getRangeByIndexes(height.row, 0, 1, sheetSpec.headers.length).format.rowHeight = height.height;
    }
    for (const rule of sheetSpec.conditionalFormats || []) {
      const startRow = rule.startRow ?? 1;
      const endRow = rule.endRow ?? sheetSpec.rows.length;
      if (endRow >= startRow) {
        sheet
          .getRangeByIndexes(startRow, rule.column, endRow - startRow + 1, 1)
          .conditionalFormats.add("cellIs", {
            operator: "equal",
            formula: rule.formula,
            format: { fill: rule.fill },
          });
      }
    }
  }
  await fs.mkdir(dirname(resolve(outputPath)), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(resolve(outputPath));
  const previews = [];
  if (previewDir) {
    await fs.mkdir(resolve(previewDir), { recursive: true });
    for (const sheetSpec of spec.sheets) {
      const preview = await workbook.render({
        sheetName: sheetSpec.name,
        autoCrop: "all",
        scale: 1,
        format: "png",
      });
      const previewPath = resolve(previewDir, `${sheetSpec.name.replaceAll("/", "-")}.png`);
      await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
      previews.push(previewPath);
    }
  }
  return { engine: "artifact-tool", previews, workbook };
}

function missingArtifactTool(error) {
  return (
    error?.code === "ERR_MODULE_NOT_FOUND" ||
    String(error?.message || "").includes("Cannot find package '@oai/artifact-tool'")
  );
}

export async function writeWorkbook(spec, outputPath, { previewDir = "", forcePortable = false } = {}) {
  let artifactToolFailure = null;
  if (!forcePortable) {
    try {
      const artifactTool = await import("@oai/artifact-tool");
      return await writeWithArtifactTool(spec, outputPath, previewDir, artifactTool);
    } catch (error) {
      artifactToolFailure = error;
    }
  }
  try {
    const result = await writePortableXlsx(spec, outputPath);
    return {
      ...result,
      previewStatus: previewDir ? "unavailable_without_artifact_tool" : "not_requested",
      ...(artifactToolFailure
        ? {
            fallbackReason: missingArtifactTool(artifactToolFailure)
              ? "artifact-tool-unavailable"
              : "artifact-tool-failed",
          }
        : {}),
    };
  } catch (portableFailure) {
    if (artifactToolFailure) {
      throw new AggregateError(
        [artifactToolFailure, portableFailure],
        "Both Artifact Tool and the portable XLSX writer failed",
      );
    }
    throw portableFailure;
  }
}

export async function readStoredZipEntries(inputPath) {
  const buffer = await fs.readFile(inputPath);
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === ZIP_LOCAL_FILE) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (method !== 0) throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    entries.set(name, buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  if (!entries.size) throw new Error("No readable files found in XLSX package");
  return entries;
}

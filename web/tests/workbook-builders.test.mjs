import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readStoredZipEntries } from "../../skills/advisor-pipeline/scripts/workbook-runtime.mjs";

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const cases = [
  {
    name: "Finder",
    script: "skills/advisor-finder/scripts/build_advisor_excel.mjs",
    input: "skills/advisor-finder/tests/sample_shortlist.json",
    output: "advisor_shortlist_20260831.xlsx",
    sheets: ["1_候选与客观筛选", "2_官方申请条件", "3_来源与缺口"],
    expectedText: "advisorProgramId",
  },
  {
    name: "Detective",
    script: "skills/advisor-detective/scripts/build_detective_excel.mjs",
    input: "skills/advisor-detective/tests/sample_detective.json",
    output: "advisor_detective_20260831.xlsx",
    sheets: ["1_导师背调汇总", "2_证据", "3_调查配置"],
    expectedText: "社区资料授权",
  },
  {
    name: "Evaluator",
    script: "skills/advisor-evaluator/scripts/build_application_ready_excel.mjs",
    input: "skills/advisor-evaluator/tests/sample_records.json",
    output: "advisor_application_ready_20260831.xlsx",
    sheets: ["1_申请就绪总表", "2_研究匹配与选择", "3_背调证据", "4_申请来源与时效", "5_配置与说明"],
    expectedText: "申请优先级",
  },
];

test("all shipped workbook builders run without private npm packages", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "advisor workbook 用户路径 "));
  try {
    const agentsSkills = resolve(scratch, "项目 副本", ".agents", "skills");
    const claudeSkills = resolve(scratch, "项目 副本", ".claude", "skills");
    await mkdir(dirname(agentsSkills), { recursive: true });
    await mkdir(dirname(claudeSkills), { recursive: true });
    await cp(resolve(repository, "skills"), agentsSkills, { recursive: true });
    await cp(resolve(repository, "skills"), claudeSkills, { recursive: true });

    // A present-but-broken optional runtime must not strand users on one machine.
    const brokenRuntime = resolve(scratch, "项目 副本", ".agents", "node_modules", "@oai", "artifact-tool");
    await mkdir(brokenRuntime, { recursive: true });
    await writeFile(
      resolve(brokenRuntime, "package.json"),
      JSON.stringify({ name: "@oai/artifact-tool", type: "module", exports: "./index.mjs" }),
    );
    await writeFile(resolve(brokenRuntime, "index.mjs"), 'throw new Error("simulated incompatible runtime");\n');

    for (const fixture of cases) {
      const output = resolve(scratch, fixture.output);
      const { stdout, stderr } = await execute(
        process.execPath,
        [
          resolve(agentsSkills, fixture.script.replace(/^skills\//, "")),
          "--input",
          resolve(repository, fixture.input),
          "--output",
          output,
        ],
        {
          cwd: scratch,
          env: {
            ...process.env,
            ADVISOR_ATLAS_FORCE_PORTABLE_XLSX: "",
            NODE_PATH: "",
          },
          windowsHide: true,
        },
      );
      assert.equal(stderr, "", `${fixture.name} wrote unexpected stderr`);
      assert.match(stdout, /"workbookEngine":"portable-ooxml"/);
      assert.ok((await stat(output)).size > 512);

      const entries = await readStoredZipEntries(output);
      assert.ok(entries.has("[Content_Types].xml"));
      assert.ok(entries.has("xl/workbook.xml"));
      assert.ok(entries.has("xl/styles.xml"));
      const workbook = entries.get("xl/workbook.xml").toString("utf8");
      for (const sheet of fixture.sheets) assert.match(workbook, new RegExp(sheet));
      const worksheetText = [...entries]
        .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .map(([, value]) => value.toString("utf8"))
        .join("\n");
      assert.match(worksheetText, new RegExp(fixture.expectedText));
      if (fixture.name === "Evaluator") {
        assert.match(worksheetText, /履历匹配分/);
        assert.match(worksheetText, /硬条件状态/);
        assert.match(worksheetText, /申请路径/);
        assert.match(worksheetText, /主申/);
        assert.match(worksheetText, /排除/);
      }
      assert.doesNotMatch(worksheetText, /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/);
    }

    const claudeOutput = resolve(scratch, "claude-finder.xlsx");
    const claude = await execute(
      process.execPath,
      [
        resolve(claudeSkills, "advisor-finder", "scripts", "build_advisor_excel.mjs"),
        "--input",
        resolve(repository, "skills/advisor-finder/tests/sample_shortlist.json"),
        "--output",
        claudeOutput,
      ],
      {
        cwd: scratch,
        env: { ...process.env, ADVISOR_ATLAS_FORCE_PORTABLE_XLSX: "", NODE_PATH: "" },
        windowsHide: true,
      },
    );
    assert.match(claude.stdout, /"workbookEngine":"portable-ooxml"/);
    assert.ok((await stat(claudeOutput)).size > 512);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

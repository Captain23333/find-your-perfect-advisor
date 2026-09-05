import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildInvestigationMenu,
  renderInvestigationMenu,
} from "../../skills/advisor-pipeline/scripts/render_investigation_menu.mjs";
import {
  DETECTIVE_SECTIONS,
  DETECTIVE_SECTION_CATALOG,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";

async function menuFixture(candidates, investigation) {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-menu-"));
  await mkdir(resolve(root, "outputs"), { recursive: true });
  await writeFile(
    resolve(root, "project.json"),
    JSON.stringify({
      schemaVersion: 4,
      id: "menu-project",
      slug: "menu-project",
      name: "菜单测试项目",
      investigation,
    }),
  );
  await writeFile(
    resolve(root, "outputs", "candidates.json"),
    JSON.stringify(candidates),
  );
  return root;
}

test("the CLI menu always renders the stable advisorProgramId column", async () => {
  const root = await menuFixture(
    [
      { advisorProgramId: "ap-1", name: "Alice Chen", school: "MIT", program: "PhD EECS" },
      {
        advisorProgramId: "ap-2",
        name: "Bob Liu",
        school: "CMU",
        program: "PhD HCI",
        fit: 8.5,
        profileMatch: 7.5,
        overallMatch: 8,
        competitiveness: "match",
        hardConstraintStatus: "pass",
        applicationPathway: "committee_led",
        recommendedAction: "apply_program",
      },
    ],
    {
      draft: {
        selectedAdvisorProgramIds: ["ap-2"],
        selectedSections: ["identity_current_role", "recent_research"],
        communitySources: { requested: false },
        revision: 5,
      },
    },
  );
  try {
    const menu = await buildInvestigationMenu(root);
    const rendered = renderInvestigationMenu(menu);

    assert.ok(rendered.includes("`ap-1`"));
    assert.ok(rendered.includes("`ap-2`"));
    // Candidate order follows candidates.json, not the model's preference.
    assert.ok(rendered.indexOf("`ap-1`") < rendered.indexOf("`ap-2`"));
    assert.equal(menu.candidates[0].advisorProgramId, "ap-1");
    assert.match(rendered, /履历匹配/);
    assert.match(rendered, /committee_led/);
    assert.match(rendered, /apply_program/);

    // All 11 dimensions, canonical order, three defaults.
    assert.deepEqual(
      menu.sections.map((section) => section.id),
      DETECTIVE_SECTIONS,
    );
    assert.deepEqual(
      menu.sections.filter((section) => section.defaultSelected).map((s) => s.id),
      DETECTIVE_SECTION_CATALOG.filter((s) => s.defaultSelected).map((s) => s.id),
    );
    for (const section of DETECTIVE_SECTION_CATALOG) {
      assert.ok(rendered.includes(section.label), `missing label ${section.label}`);
    }

    assert.equal(menu.cost.workUnits, 2);
    assert.equal(menu.cost.level, "low");
    assert.equal(menu.selection.revision, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a candidate without a stable id stops the selection stage", async () => {
  const root = await menuFixture(
    [{ advisorProgramId: "ap-1", name: "Alice" }, { name: "No Id" }],
    { draft: { selectedAdvisorProgramIds: [], selectedSections: [] } },
  );
  try {
    await assert.rejects(
      () => buildInvestigationMenu(root),
      /advisorProgramId/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the menu renders from project.json and candidates.json alone", async () => {
  const root = await menuFixture(
    [{ advisorProgramId: "ap-1", name: "Alice", school: "MIT", program: "PhD" }],
    {
      draft: {
        selectedAdvisorProgramIds: ["ap-1"],
        selectedSections: DETECTIVE_SECTIONS,
        communitySources: { requested: true },
        revision: 1,
      },
    },
  );
  try {
    // No advisor_records.json, evidence.json, detective-results.json, or
    // community-cache/ exists here at all: if the script needed them it would
    // throw instead of producing a menu.
    const menu = await buildInvestigationMenu(root);
    assert.equal(menu.cost.workUnits, 11);
    assert.equal(menu.cost.level, "medium");
    const rendered = renderInvestigationMenu(menu);
    assert.match(rendered, /此选择菜单只读取 project\.json、candidates\.json/);
    assert.match(rendered, /确认后才按已选对象与维度开始背调/);
    assert.match(rendered, /社区资料本地下载：已请求/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

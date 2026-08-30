import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DETECTIVE_SECTIONS,
  DETECTIVE_SECTIONS,
} from "../local-runtime/project-store.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function parseReferenceMenu(reference) {
  const block = reference.match(
    /## CLI selection menu([\s\S]*?)## Cost level/,
  )?.[1];
  assert.ok(block, "canonical CLI selection menu is missing");
  return [...block.matchAll(
    /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm,
  )].map((match) => ({
    number: Number(match[1]),
    id: match[2],
    label: match[3].trim(),
    defaultSelected: match[4].trim() === "selected by default",
  }));
}

function parseFrontendOptions(pageSource) {
  const block = pageSource.match(
    /const detectiveSectionOptions = \[([\s\S]*?)\n\];/,
  )?.[1];
  assert.ok(block, "frontend detective option list is missing");
  return [...block.matchAll(
    /\{ id: "([^"]+)", label: "([^"]+)"(, defaultSelected: true)? \}/g,
  )].map((match) => ({
    id: match[1],
    label: match[2],
    defaultSelected: Boolean(match[3]),
  }));
}

test("Web and CLI share one ordered investigation option contract", async () => {
  const [reference, pageSource] = await Promise.all([
    readFile(
      resolve(
        repositoryRoot,
        "skills/advisor-detective/references/investigation-sections.md",
      ),
      "utf8",
    ),
    readFile(resolve(repositoryRoot, "web/app/page.tsx"), "utf8"),
  ]);

  const referenceOptions = parseReferenceMenu(reference);
  const frontendOptions = parseFrontendOptions(pageSource);

  assert.equal(referenceOptions.length, 11);
  assert.deepEqual(
    referenceOptions.map(({ id }) => id),
    DETECTIVE_SECTIONS,
  );
  assert.deepEqual(
    referenceOptions.filter(({ defaultSelected }) => defaultSelected).map(({ id }) => id),
    DEFAULT_DETECTIVE_SECTIONS,
  );
  assert.deepEqual(
    frontendOptions,
    referenceOptions.map(({ id, label, defaultSelected }) => ({
      id,
      label,
      defaultSelected,
    })),
  );

  assert.match(reference, /low: work units <= 8/);
  assert.match(reference, /medium: work units 9-24/);
  assert.match(reference, /high: work units > 24/);
  assert.match(pageSource, /selected\.size \* selectedSections\.size > 24/);
  assert.match(pageSource, /selected\.size \* selectedSections\.size > 8/);

  const communityReference = reference.match(
    /## Community-source consent trigger([\s\S]*?)## Guidance/,
  )?.[1];
  assert.ok(communityReference, "community consent trigger list is missing");
  const communityIds = [...communityReference.matchAll(/^- `([^`]+)`$/gm)].map(
    (match) => match[1],
  );
  const frontendCommunityBlock = pageSource.match(
    /const communityRelevant = \[([\s\S]*?)\]\.some/,
  )?.[1];
  assert.ok(frontendCommunityBlock, "frontend community trigger list is missing");
  const frontendCommunityIds = [
    ...frontendCommunityBlock.matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(frontendCommunityIds, communityIds);
});

test("Web saves draft first and refreshes community sources only after confirmation", async () => {
  const [pageSource, serverSource] = await Promise.all([
    readFile(resolve(repositoryRoot, "web/app/page.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "web/local-runtime/server.mjs"), "utf8"),
  ]);
  const saveFunction = pageSource.match(
    /async function saveInvestigationConfiguration\([\s\S]*?\r?\n  }\r?\n\r?\n  async function refreshCommunityKnowledge/,
  )?.[0];
  assert.ok(saveFunction, "draft save function is missing");
  assert.match(saveFunction, /investigation:\s*\{\s*draft:/);
  assert.doesNotMatch(saveFunction, /confirmed:/);

  const confirmFunction = pageSource.match(
    /async function confirmAndStartInvestigation\(\)[\s\S]*?\r?\n  }\r?\n\r?\n  function startRanking/,
  )?.[0];
  assert.ok(confirmFunction, "final confirmation function is missing");
  const confirmPosition = confirmFunction.indexOf("/investigation/confirm");
  const refreshPosition = confirmFunction.indexOf("refreshCommunityKnowledge");
  assert.ok(confirmPosition >= 0, "final confirmation endpoint is not called");
  assert.ok(
    refreshPosition > confirmPosition,
    "community refresh must happen only after final confirmation",
  );
  assert.match(serverSource, /communityRefreshEligibility\(project\.investigation\)/);
});

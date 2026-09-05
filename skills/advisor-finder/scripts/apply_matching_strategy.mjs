#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  normalizeApplicationPathway,
  normalizeHardConstraintStatus,
  normalizeOpportunityStatus,
  normalizePortfolioStrategy,
  normalizeShortlistTarget,
  recommendedActionForCandidate,
} from "../../advisor-pipeline/scripts/project-contract.mjs";
import { isExecutedDirectly } from "../../advisor-pipeline/scripts/direct-execution.mjs";

export const MATCHING_CONTRACT_VERSION = 2;

const REACH_CAPS = {
  conservative: 0.2,
  balanced: 0.3,
  ambitious: 0.5,
};

function optionalScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : null;
}

function stringList(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function deterministicOverallMatch(fit, profileMatch) {
  const research = optionalScore(fit);
  const profile = optionalScore(profileMatch);
  if (research === null || profile === null) return null;
  return Math.round((research * 0.6 + profile * 0.4) * 10) / 10;
}

export function normalizeMatchingCandidate(candidate, index = 0) {
  const fit = optionalScore(candidate?.fit);
  const profileMatch = optionalScore(candidate?.profileMatch);
  const normalized = {
    ...candidate,
    rank: index + 1,
    fit,
    profileMatch,
    overallMatch: deterministicOverallMatch(fit, profileMatch),
    competitiveness: ["reach", "match", "safer", "unknown"].includes(
      String(candidate?.competitiveness),
    )
      ? String(candidate.competitiveness)
      : "unknown",
    hardConstraintStatus: normalizeHardConstraintStatus(candidate?.hardConstraintStatus),
    hardConstraintReasons: stringList(candidate?.hardConstraintReasons),
    applicationPathway: normalizeApplicationPathway(candidate?.applicationPathway),
    opportunityStatus: normalizeOpportunityStatus(candidate?.opportunityStatus),
    matchReasons: stringList(candidate?.matchReasons),
    feasibility: ["eligible", "ineligible", "needs_confirmation"].includes(
      String(candidate?.feasibility),
    )
      ? String(candidate.feasibility)
      : "needs_confirmation",
    matchingContractVersion: MATCHING_CONTRACT_VERSION,
  };
  normalized.recommendedAction = recommendedActionForCandidate(normalized);
  return normalized;
}

function sortScore(candidate) {
  if (candidate.overallMatch !== null) return candidate.overallMatch;
  const components = [candidate.fit, candidate.profileMatch].filter((value) => value !== null);
  return components.length
    ? components.reduce((sum, value) => sum + value, 0) / components.length
    : -1;
}

function exclusionReason(candidate, selectedIds) {
  if (candidate.recommendedAction === "exclude") {
    if (candidate.hardConstraintStatus === "fail") return "hard_constraint";
    if (candidate.opportunityStatus === "verified_closed") return "verified_closed";
    return "ineligible";
  }
  return selectedIds.has(candidate.advisorProgramId) ? "" : "shortlist_or_portfolio_limit";
}

export function buildPortfolioShortlist(rawCandidates, options = {}) {
  const strategy = normalizePortfolioStrategy(options.portfolioStrategy);
  const shortlistTarget = normalizeShortlistTarget(options.shortlistTarget);
  const hasHardConstraints = Boolean(String(options.hardConstraints || "").trim());
  const normalized = (Array.isArray(rawCandidates) ? rawCandidates : []).map(
    (candidate, index) => {
      const row = normalizeMatchingCandidate(candidate, index);
      if (!hasHardConstraints && row.hardConstraintStatus === "unknown") {
        row.hardConstraintStatus = "pass";
        row.recommendedAction = recommendedActionForCandidate(row);
      }
      return row;
    },
  );
  const ids = normalized.map((candidate) => String(candidate.advisorProgramId || "").trim());
  if (ids.some((id) => !id)) throw new Error("候选缺少稳定的 advisorProgramId");
  if (new Set(ids).size !== ids.length) throw new Error("候选的 advisorProgramId 有重复");
  const comparable = normalized
    .filter((candidate) => candidate.recommendedAction !== "exclude")
    .sort((left, right) => sortScore(right) - sortScore(left) || left.rank - right.rank);
  const reachCap = Math.floor(shortlistTarget * REACH_CAPS[strategy]);
  const selected = [];
  const deferredReach = [];
  let reachCount = 0;

  for (const candidate of comparable) {
    if (selected.length >= shortlistTarget) break;
    if (candidate.competitiveness === "reach" && reachCount >= reachCap) {
      deferredReach.push(candidate);
      continue;
    }
    selected.push(candidate);
    if (candidate.competitiveness === "reach") reachCount += 1;
  }
  for (const candidate of deferredReach) {
    if (selected.length >= shortlistTarget) break;
    selected.push(candidate);
    reachCount += 1;
  }

  const selectedIds = new Set(selected.map((candidate) => candidate.advisorProgramId));
  const ranked = selected.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    portfolioSelected: true,
  }));
  const excluded = normalized
    .filter((candidate) => !selectedIds.has(candidate.advisorProgramId))
    .map((candidate) => ({
      ...candidate,
      portfolioSelected: false,
      exclusionReason: exclusionReason(candidate, selectedIds),
    }));
  const knownTierCount = ranked.filter((candidate) => candidate.competitiveness !== "unknown").length;
  const audit = {
    matchingContractVersion: MATCHING_CONTRACT_VERSION,
    strategy,
    shortlistTarget,
    inputCount: normalized.length,
    selectedCount: ranked.length,
    excludedCount: excluded.length,
    reachCap,
    reachCount,
    unknownTierCount: ranked.length - knownTierCount,
    unknownPathwayCount: ranked.filter((candidate) => candidate.applicationPathway === "unknown").length,
    unknownOpportunityCount: ranked.filter((candidate) => candidate.opportunityStatus === "unknown").length,
    portfolioDeviation:
      reachCount > reachCap
        ? "insufficient_non_reach_candidates"
        : ranked.length < shortlistTarget
          ? "insufficient_eligible_candidates"
          : null,
  };
  return { selected: ranked, excluded, audit };
}

export function mergePriorSelectionForRerun(candidates, excluded) {
  const current = Array.isArray(candidates) ? candidates : [];
  const priorExcluded = Array.isArray(excluded) ? excluded : [];
  const isPriorSelection =
    current.length > 0 &&
    current.every(
      (candidate) =>
        candidate?.matchingContractVersion === MATCHING_CONTRACT_VERSION &&
        candidate?.portfolioSelected === true,
    );
  if (!isPriorSelection) return current;
  const currentIds = new Set(current.map((candidate) => candidate?.advisorProgramId));
  return [
    ...current,
    ...priorExcluded.filter(
      (candidate) =>
        candidate?.matchingContractVersion === MATCHING_CONTRACT_VERSION &&
        !currentIds.has(candidate?.advisorProgramId),
    ),
  ];
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function main() {
  const rootIndex = process.argv.indexOf("--project-root");
  const rawProjectRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] || "" : "";
  if (!rawProjectRoot) {
    throw new Error("Usage: apply_matching_strategy.mjs --project-root <project-directory>");
  }
  const projectRoot = resolve(rawProjectRoot);
  const [project, candidates, previousExcluded] = await Promise.all([
    readFile(resolve(projectRoot, "project.json"), "utf8").then(JSON.parse),
    readFile(resolve(projectRoot, "outputs", "candidates.json"), "utf8").then(JSON.parse),
    readFile(resolve(projectRoot, "outputs", "candidates-excluded.json"), "utf8")
      .then(JSON.parse)
      .catch(() => []),
  ]);
  if (!Array.isArray(candidates)) throw new Error("outputs/candidates.json 顶层必须是数组");
  const result = buildPortfolioShortlist(
    mergePriorSelectionForRerun(candidates, previousExcluded),
    project,
  );
  const generatedAt = new Date().toISOString();
  await Promise.all([
    writeJsonAtomic(resolve(projectRoot, "outputs", "candidates.json"), result.selected),
    writeJsonAtomic(resolve(projectRoot, "outputs", "candidates-excluded.json"), result.excluded),
    writeJsonAtomic(resolve(projectRoot, "outputs", "matching-audit.json"), {
      ...result.audit,
      generatedAt,
    }),
  ]);
  console.log(JSON.stringify({ ...result.audit, generatedAt }));
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}

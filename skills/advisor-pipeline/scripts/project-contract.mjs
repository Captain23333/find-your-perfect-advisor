import { createHash } from "node:crypto";

export const PROJECT_SCHEMA_VERSION = 4;
export const STATUS_SCHEMA_VERSION = 2;

export const DEFAULT_DETECTIVE_SECTIONS = [
  "identity_current_role",
  "recent_research",
  "current_projects_recruiting",
];

export const DETECTIVE_SECTIONS = [
  ...DEFAULT_DETECTIVE_SECTIONS,
  "research_output_trend",
  "group_members_outcomes",
  "guidance_group_ecology",
  "work_style_pressure",
  "resources_career_support",
  "integrity_public_controversies",
  "international_student_support",
  "collaboration_industry_network",
];

// The single ordered catalog both the Web checkboxes and the CLI menu render.
export const DETECTIVE_SECTION_CATALOG = [
  { id: "identity_current_role", label: "基础身份与当前职位", defaultSelected: true },
  { id: "recent_research", label: "最近三年研究兴趣与方向", defaultSelected: true },
  {
    id: "current_projects_recruiting",
    label: "近期项目与招生状态",
    defaultSelected: true,
  },
  { id: "research_output_trend", label: "研究产出与趋势", defaultSelected: false },
  { id: "group_members_outcomes", label: "课题组成员及去向", defaultSelected: false },
  { id: "guidance_group_ecology", label: "指导环境与组内生态", defaultSelected: false },
  { id: "work_style_pressure", label: "工作方式与压力", defaultSelected: false },
  {
    id: "resources_career_support",
    label: "资源、funding、署名与职业支持",
    defaultSelected: false,
  },
  {
    id: "integrity_public_controversies",
    label: "学术诚信与公开争议",
    defaultSelected: false,
  },
  {
    id: "international_student_support",
    label: "国际学生支持",
    defaultSelected: false,
  },
  {
    id: "collaboration_industry_network",
    label: "合作者、产业和职业网络",
    defaultSelected: false,
  },
];

export function investigationCostLevel(workUnits) {
  if (workUnits <= 8) return "low";
  if (workUnits <= 24) return "medium";
  return "high";
}

export const COMMUNITY_SECTION_IDS = [
  "guidance_group_ecology",
  "work_style_pressure",
  "resources_career_support",
];

export const STRUCTURED_OUTPUT_FILES = [
  "candidates.json",
  "advisor_records.json",
  "program_records.json",
  "evidence.json",
];

function text(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function validTimestamp(value, fallback) {
  const candidate = text(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
}

export function normalizeShortlistTarget(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(5, Math.min(50, Math.round(parsed)));
}

export function normalizeInterests(input) {
  if (!Array.isArray(input)) return [];
  const interests = input
    .map((interest) =>
      typeof interest === "string"
        ? { name: text(interest, 120), weight: Number.NaN }
        : {
            name: text(interest?.name, 120),
            weight: Number(interest?.weight),
          },
    )
    .filter((interest) => interest.name);
  if (!interests.length) return [];

  const explicitTotal = interests.reduce(
    (sum, interest) =>
      sum + (Number.isFinite(interest.weight) && interest.weight > 0 ? interest.weight : 0),
    0,
  );
  const missingCount = interests.filter(
    (interest) => !Number.isFinite(interest.weight) || interest.weight <= 0,
  ).length;
  const explicitCount = interests.length - missingCount;
  const fallbackWeight =
    explicitTotal > 0 && explicitTotal < 100 && missingCount > 0
      ? (100 - explicitTotal) / missingCount
      : explicitTotal > 0 && explicitCount > 0
        ? explicitTotal / explicitCount
        : 1;
  const basis = interests.map((interest) => ({
    ...interest,
    weight:
      Number.isFinite(interest.weight) && interest.weight > 0
        ? interest.weight
        : fallbackWeight,
  }));
  const total = basis.reduce((sum, interest) => sum + interest.weight, 0);
  return basis.map((interest, index) => ({
    name: interest.name,
    weight:
      index === basis.length - 1
        ? Math.round(
            (100 -
              basis
                .slice(0, -1)
                .reduce(
                  (sum, item) => sum + Math.round((item.weight / total) * 1000) / 10,
                  0,
                )) * 10,
          ) / 10
        : Math.round((interest.weight / total) * 1000) / 10,
  }));
}

function normalizeSectionList(input, fallback = []) {
  if (!Array.isArray(input)) return [...fallback];
  return [
    ...new Set(input.map(String).filter((item) => DETECTIVE_SECTIONS.includes(item))),
  ];
}

function normalizeSelection(input, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  const selectedIds =
    source.selectedAdvisorProgramIds ??
    source.selected_advisor_program_ids ??
    fallback.selectedAdvisorProgramIds ??
    [];
  const selectedSections =
    source.selectedSections ??
    source.selected_sections ??
    fallback.selectedSections;
  const community = source.communitySources ?? source.community_sources ?? {};
  return {
    selectedAdvisorProgramIds: [
      ...new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String).filter(Boolean)),
    ],
    selectedSections: normalizeSectionList(
      selectedSections,
      DEFAULT_DETECTIVE_SECTIONS,
    ),
    communitySources: {
      requested: Boolean(
        community.requested ??
          community.consented ??
          fallback.communitySources?.requested ??
          false,
      ),
    },
  };
}

function sameSelection(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeConfirmed(input, now) {
  if (!input || typeof input !== "object") return null;
  const selection = normalizeSelection({
    ...input,
    communitySources: {
      requested: Boolean(input.communitySources?.consented),
    },
  });
  const consented =
    hasCommunitySections(selection.selectedSections) &&
    Boolean(input.communitySources?.consented);
  return {
    selectedAdvisorProgramIds: selection.selectedAdvisorProgramIds,
    selectedSections: selection.selectedSections,
    communitySources: {
      consented,
      consentedAt: consented
        ? validTimestamp(input.communitySources?.consentedAt, now)
        : null,
    },
    revision: Math.max(0, Number(input.revision) || 0),
    confirmedAt: validTimestamp(input.confirmedAt, now),
    fingerprint:
      text(input.fingerprint, 128) ||
      investigationFingerprint({
        selectedAdvisorProgramIds: selection.selectedAdvisorProgramIds,
        selectedSections: selection.selectedSections,
        communitySources: { consented },
      }),
    source: input.source === "legacy_artifact" ? "legacy_artifact" : "user_confirmed",
  };
}

export function normalizeInvestigation(input, now = new Date().toISOString()) {
  const source = input && typeof input === "object" ? input : {};
  const draftSource = source.draft ?? source;
  const selection = normalizeSelection(draftSource);
  return {
    draft: {
      ...selection,
      revision: Math.max(0, Number(draftSource.revision) || 0),
      updatedAt: validTimestamp(draftSource.updatedAt, now),
    },
    confirmed: normalizeConfirmed(source.confirmed, now),
  };
}

export function updateInvestigationDraft(
  existing,
  patch,
  now = new Date().toISOString(),
) {
  const current = normalizeInvestigation(existing, now);
  const source = patch?.draft ?? patch ?? {};
  const nextSelection = normalizeSelection(source, current.draft);
  if (!hasCommunitySections(nextSelection.selectedSections)) {
    nextSelection.communitySources.requested = false;
  }
  const currentSelection = {
    selectedAdvisorProgramIds: current.draft.selectedAdvisorProgramIds,
    selectedSections: current.draft.selectedSections,
    communitySources: current.draft.communitySources,
  };
  const changed = !sameSelection(nextSelection, currentSelection);
  return {
    draft: {
      ...nextSelection,
      revision: changed ? current.draft.revision + 1 : current.draft.revision,
      updatedAt: changed ? now : current.draft.updatedAt,
    },
    confirmed: current.confirmed,
  };
}

export function hasCommunitySections(selectedSections) {
  return Array.isArray(selectedSections) &&
    selectedSections.some((section) => COMMUNITY_SECTION_IDS.includes(section));
}

export function investigationFingerprint(selection) {
  const canonical = {
    selectedAdvisorProgramIds: [
      ...new Set((selection?.selectedAdvisorProgramIds || []).map(String)),
    ].sort(),
    selectedSections: [
      ...new Set((selection?.selectedSections || []).map(String)),
    ].sort(),
    communityConsent: Boolean(selection?.communitySources?.consented),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function isInvestigationConfirmationCurrent(investigation) {
  const current = normalizeInvestigation(investigation);
  if (!current.confirmed) return false;
  return (
    current.confirmed.revision === current.draft.revision &&
    current.confirmed.fingerprint ===
      investigationFingerprint({
        selectedAdvisorProgramIds: current.draft.selectedAdvisorProgramIds,
        selectedSections: current.draft.selectedSections,
        communitySources: {
          consented:
            hasCommunitySections(current.draft.selectedSections) &&
            current.draft.communitySources.requested,
        },
      })
  );
}

export function communityRefreshEligibility(investigation) {
  const current = normalizeInvestigation(investigation);
  if (!current.confirmed) {
    return { allowed: false, reason: "请先最终确认本次导师背调配置" };
  }
  if (!isInvestigationConfirmationCurrent(current)) {
    return { allowed: false, reason: "调查选择已发生变化，请重新确认后再刷新社区资料" };
  }
  if (!hasCommunitySections(current.confirmed.selectedSections)) {
    return { allowed: false, reason: "当前已确认的调查维度不需要社区资料" };
  }
  if (!current.confirmed.communitySources.consented) {
    return { allowed: false, reason: "请先明确同意在本地下载第三方社区资料" };
  }
  return { allowed: true, reason: null };
}

export function validateInvestigationDraftAgainstCandidates(
  investigation,
  candidates,
) {
  const current = normalizeInvestigation(investigation);
  const errors = [];
  if (!current.draft.selectedAdvisorProgramIds.length) {
    errors.push("请至少选择一个导师—项目组合");
  }
  if (!current.draft.selectedSections.length) {
    errors.push("请至少选择一个背调维度");
  }
  const candidateIds = new Set(
    (Array.isArray(candidates) ? candidates : [])
      .map((candidate) =>
        typeof candidate === "string"
          ? candidate
          : String(candidate?.advisorProgramId || ""),
      )
      .filter(Boolean),
  );
  const invalidIds = current.draft.selectedAdvisorProgramIds.filter(
    (id) => !candidateIds.has(id),
  );
  if (invalidIds.length) {
    errors.push(`以下导师—项目组合已不存在：${invalidIds.join("、")}`);
  }
  return { valid: errors.length === 0, errors, draft: current.draft };
}

export function confirmInvestigationDraft(
  investigation,
  { expectedRevision, now = new Date().toISOString(), source = "user_confirmed" } = {},
) {
  const current = normalizeInvestigation(investigation, now);
  if (source !== "legacy_artifact" && !Number.isInteger(expectedRevision)) {
    const error = new Error("缺少有效的调查草稿版本，请重新检查最终摘要");
    error.code = "MISSING_DRAFT_REVISION";
    throw error;
  }
  if (
    expectedRevision !== undefined &&
    Number(expectedRevision) !== current.draft.revision
  ) {
    const error = new Error("调查草稿已发生变化，请重新检查最终摘要");
    error.code = "STALE_DRAFT";
    throw error;
  }
  const consented =
    hasCommunitySections(current.draft.selectedSections) &&
    current.draft.communitySources.requested;
  const confirmed = {
    selectedAdvisorProgramIds: [...current.draft.selectedAdvisorProgramIds],
    selectedSections: [...current.draft.selectedSections],
    communitySources: {
      consented,
      consentedAt: consented ? now : null,
    },
    revision: current.draft.revision,
    confirmedAt: now,
    fingerprint: "",
    source: source === "legacy_artifact" ? "legacy_artifact" : "user_confirmed",
  };
  confirmed.fingerprint = investigationFingerprint(confirmed);
  return { draft: current.draft, confirmed };
}

export function normalizeProjectMetadata(
  input,
  {
    fallbackId = "local-project",
    now = new Date().toISOString(),
    legacyDetectiveResults = null,
  } = {},
) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = text(source.id || source.slug || fallbackId, 120) || "local-project";
  const slug = text(source.slug || source.id || fallbackId, 120) || id;
  const createdAt = validTimestamp(source.createdAt, now);
  const normalized = {
    ...source,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    slug,
    name: text(source.name || slug, 120) || "未命名申请项目",
    season: text(source.season, 80),
    degree: text(source.degree, 80),
    target: text(source.target, 500),
    interests: normalizeInterests(source.interests),
    shortlistTarget: normalizeShortlistTarget(
      source.shortlistTarget ?? source.shortlist_target,
    ),
    cv:
      source.cv && typeof source.cv === "object" && !Array.isArray(source.cv)
        ? {
            ...source.cv,
            name: text(source.cv.name, 240),
            path: text(source.cv.path, 2000),
            size: Math.max(0, Number(source.cv.size) || 0),
            type: text(source.cv.type || "application/octet-stream", 160),
            uploadedAt: validTimestamp(source.cv.uploadedAt, createdAt),
          }
        : null,
    investigation: normalizeInvestigation(source.investigation, now),
    createdAt,
    updatedAt: validTimestamp(source.updatedAt, createdAt),
  };
  if (
    Number(source.schemaVersion || 0) < PROJECT_SCHEMA_VERSION &&
    Array.isArray(legacyDetectiveResults?.results) &&
    legacyDetectiveResults.results.length > 0
  ) {
    const legacyIds = legacyDetectiveResults.results
      .map((result) => text(result?.advisorProgramId, 500))
      .filter(Boolean);
    if (legacyIds.length > 0) {
      const legacySections = normalizeSectionList(
        legacyDetectiveResults.selectedSections,
        normalized.investigation.draft.selectedSections,
      );
      // Only the artifact records what a completed run was actually allowed to
      // use. A v3 project.json consent flag was written on checkbox click and
      // never proved confirmation, so it cannot authorize community sources.
      const legacyConsent = Boolean(
        legacyDetectiveResults.communitySources?.consented ??
          legacyDetectiveResults.community_sources?.consented,
      );
      normalized.investigation.draft = {
        ...normalized.investigation.draft,
        selectedAdvisorProgramIds: [...new Set(legacyIds)],
        selectedSections: legacySections,
        communitySources: { requested: legacyConsent },
      };
      normalized.investigation = confirmInvestigationDraft(
        normalized.investigation,
        { now, source: "legacy_artifact" },
      );
    }
  }
  delete normalized.shortlist_target;
  return normalized;
}

// Every stage has its own preconditions. Checking `phase1Ready` for all of
// them locked migrated projects — ones that already have candidates and
// detective results but a stale CV path — out of Phase 2 and Phase 3.
export const RUN_MODE_IDS = ["finder", "finder_objective", "detective", "ranking"];

export function readinessForProject({
  metadata,
  candidates = [],
  detectiveResults = null,
  cvValid = false,
} = {}) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const hasInterests = Array.isArray(source.interests) && source.interests.length > 0;
  const hasCv = Boolean(cvValid);
  const checks = [
    { key: "target", label: "填写目标院校或地区范围", complete: Boolean(source.target) },
    {
      key: "matching_signal",
      label: "上传 CV 或填写至少一个研究兴趣",
      complete: hasCv || hasInterests,
    },
  ];
  const objectiveChecks = [
    { key: "degree", label: "填写目标学位", complete: Boolean(source.degree) },
    { key: "season", label: "填写申请季", complete: Boolean(source.season) },
  ];
  const phase1Ready = checks.every((item) => item.complete);
  const objectiveReady = objectiveChecks.every((item) => item.complete);

  const candidateList = Array.isArray(candidates) ? candidates : [];
  const usableCandidates = candidateList.filter((candidate) =>
    String(candidate?.advisorProgramId || "").trim(),
  );
  const confirmationCurrent = isInvestigationConfirmationCurrent(source.investigation);
  const confirmed = normalizeInvestigation(source.investigation).confirmed;
  const detectiveDone =
    Array.isArray(detectiveResults?.results) && detectiveResults.results.length > 0;

  const finderMissing = checks
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const objectiveMissing = objectiveChecks
    .filter((item) => !item.complete)
    .map((item) => item.label);

  const finderObjectiveMissing = [
    ...finderMissing,
    ...(usableCandidates.length ? [] : ["先完成 Phase 1 的导师发现"]),
    ...objectiveMissing,
  ];

  const detectiveMissing = [
    ...(usableCandidates.length ? [] : ["先产生带稳定 ID 的候选导师"]),
    ...(confirmed ? [] : ["最终确认本次背调配置"]),
    ...(confirmed && !confirmationCurrent
      ? ["调查选择已变化，请重新最终确认"]
      : []),
  ];

  const rankingMissing = detectiveDone ? [] : ["先完成一轮导师背调并生成结果"];

  const modes = {
    finder: { ready: !finderMissing.length, missing: finderMissing },
    finder_objective: {
      ready: !finderObjectiveMissing.length,
      missing: finderObjectiveMissing,
    },
    detective: { ready: !detectiveMissing.length, missing: detectiveMissing },
    ranking: { ready: !rankingMissing.length, missing: rankingMissing },
  };

  return {
    ready: phase1Ready,
    phase1Ready,
    objectiveReady,
    completed: checks.filter((item) => item.complete).length,
    total: checks.length,
    checks,
    missing: finderMissing,
    objectiveChecks,
    objectiveMissing,
    matchingSignal: hasCv ? "cv" : hasInterests ? "interests" : "none",
    interestWeightTotal: hasInterests ? 100 : 0,
    cvValid: hasCv,
    modes,
  };
}

export function createStatus(now = new Date().toISOString()) {
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    phase: "intake",
    stage: "intake",
    candidateCount: 0,
    shortlistCount: 0,
    objectiveReadyCount: 0,
    selectedCount: 0,
    evidenceCount: 0,
    evidenceCoverage: 0,
    rankingCount: 0,
    updatedAt: now,
  };
}

export function normalizeStatus(input, now = new Date().toISOString()) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const defaults = createStatus(now);
  return {
    ...defaults,
    ...source,
    schemaVersion: STATUS_SCHEMA_VERSION,
    phase: text(source.phase || defaults.phase, 80),
    stage: text(source.stage || defaults.stage, 80),
    candidateCount: Math.max(0, Number(source.candidateCount) || 0),
    shortlistCount: Math.max(0, Number(source.shortlistCount ?? source.highMatchCount) || 0),
    objectiveReadyCount: Math.max(0, Number(source.objectiveReadyCount) || 0),
    selectedCount: Math.max(0, Number(source.selectedCount) || 0),
    evidenceCount: Math.max(0, Number(source.evidenceCount) || 0),
    evidenceCoverage: Math.max(0, Number(source.evidenceCoverage) || 0),
    rankingCount: Math.max(0, Number(source.rankingCount) || 0),
    updatedAt: validTimestamp(source.updatedAt, now),
  };
}

export function validateProjectMetadata(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["project.json 顶层必须是对象"] };
  }
  if (input.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${PROJECT_SCHEMA_VERSION}`);
  }
  for (const key of ["id", "slug", "name", "createdAt", "updatedAt"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      errors.push(`${key} 必须是非空字符串`);
    }
  }
  if (!Array.isArray(input.interests)) {
    errors.push("interests 必须是数组");
  } else if (
    input.interests.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.name !== "string" ||
        !Number.isFinite(item.weight),
    )
  ) {
    errors.push("每个 interest 必须包含 name 和数值 weight");
  }
  if (!Array.isArray(input.investigation?.draft?.selectedAdvisorProgramIds)) {
    errors.push("investigation.draft.selectedAdvisorProgramIds 必须是数组");
  }
  if (!Array.isArray(input.investigation?.draft?.selectedSections)) {
    errors.push("investigation.draft.selectedSections 必须是数组");
  }
  if (
    input.investigation?.confirmed !== null &&
    input.investigation?.confirmed !== undefined &&
    (!Array.isArray(input.investigation.confirmed.selectedAdvisorProgramIds) ||
      !Array.isArray(input.investigation.confirmed.selectedSections) ||
      !input.investigation.confirmed.fingerprint)
  ) {
    errors.push("investigation.confirmed 必须是完整确认快照或 null");
  }
  return { valid: errors.length === 0, errors };
}

# Selectable advisor investigation sections

Use stable section IDs in state and user-facing Chinese labels in the UI.

## Finder-collected defaults

These sections are checked by default. The user may uncheck one after seeing a
warning that the shortlist may be incomplete or stale.

| ID | Label |
| --- | --- |
| `identity_current_role` | 基础身份与当前职位 |
| `recent_research` | 最近三年研究兴趣与方向 |
| `current_projects_recruiting` | 近期项目与招生状态 |

The objective application-feasibility pass is required for shortlisted
advisor-program combinations and is not a reputation checkbox.

## Detective selections

| ID | Label | Typical sources |
| --- | --- | --- |
| `research_output_trend` | 研究产出与趋势 | Papers, Scholar, dblp, OpenReview |
| `group_members_outcomes` | 课题组成员及去向 | Lab roster, theses, alumni pages, public profiles |
| `guidance_group_ecology` | 指导环境与组内生态 | Identified accounts, community leads, public discussions |
| `work_style_pressure` | 工作方式与压力 | Identified accounts and carefully labelled community leads |
| `resources_career_support` | 资源、funding、署名与职业支持 | Grants, acknowledgements, alumni outcomes, public accounts |
| `integrity_public_controversies` | 学术诚信与公开争议 | Retractions, corrections, institutions, primary records |
| `international_student_support` | 国际学生支持 | Group roster, alumni outcomes, identified accounts |
| `collaboration_industry_network` | 合作者、产业和职业网络 | Papers, grants, labs, company and university announcements |

## Guidance and group ecology subdimensions

When selected, organize findings under:

1. 人品与边界：尊重、信用、权力边界。
2. 指导与判断力：research guidance、方向稳定性、反馈质量。
3. 工作方式：节奏、push 程度、学生自主性。
4. 资源与回报：funding、算力、署名、推荐信和职业发展是否公平。
5. 组内生态：学生流动、转组或退出、公开可核实的组内体验。

Do not calculate a personality score from anonymous reports. Store supported
findings, conflicting accounts, and unresolved risks.

## Empty values

- Selected and checked with no reliable information: `检查后未找到可靠公开信息`.
- Not selected: `用户未选择复核`.
- Blocked by access or extraction failure: `未完成核验` plus the reason.
- Conflicting accounts: preserve both and mark `存在冲突`.

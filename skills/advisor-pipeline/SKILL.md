---
name: advisor-pipeline
description: >
  导师匹配全流水线编排技能（Advisor Pipeline）。串联 advisor-finder、advisor-detective、advisor-evaluator 三个技能，
  实现从 CV 到最终导师综合排名的全自动化流程。
  触发场景：用户说"开始导师匹配"、"帮我找导师"、"从头开始导师筛选"、"走完整个流水线"、"导师pipeline"、"导师匹配流程"。
  当用户有 CV 并想找导师时，优先触发此技能而非单独触发 advisor-finder。
---

# 🎓 导师匹配全流水线 (Advisor Pipeline)

## 流水线概览

```
┌─────────────────────────────────────────────────────────────────┐
│              导师匹配全流水线 (Advisor Pipeline)                   │
│                                                                 │
│  📄 CV + 目标                                                    │
│     ↓                                                           │
│  ┌──────────────────┐                                           │
│  │  Phase 1         │  advisor-finder                           │
│  │  导师发现 & 匹配   │  → ADVISOR_STATE.md                       │
│  │                  │  → advisor_shortlist_[日期].xlsx           │
│  └────────┬─────────┘                                           │
│           ↓  Top 10 导师（默认）                                  │
│  ┌──────────────────┐                                           │
│  │  Phase 2         │  advisor-detective                        │
│  │  深度背景调查      │  → DETECTIVE_STATE.md                     │
│  │  [用户确认深度]   │  → advisor_detective_[日期].xlsx           │
│  └────────┬─────────┘                                           │
│           ↓                                                     │
│  ┌──────────────────┐                                           │
│  │  Phase 3         │  advisor-evaluator                        │
│  │  综合评分 & 排名   │  → EVALUATOR_STATE.md                     │
│  │  [用户确认权重]   │  → advisor_final_ranking_[日期].xlsx       │
│  └────────┬─────────┘                                           │
│           ↓                                                     │
│  📊 最终导师综合排名（含决策建议）                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 流水线执行规则

### 原则一：技能串联，状态共享

三个技能共享同一工作目录下的状态文件：
- `ADVISOR_STATE.md` — advisor-finder 输出，advisor-detective 读取
- `DETECTIVE_STATE.md` — advisor-detective 输出，advisor-evaluator 读取
- `EVALUATOR_STATE.md` — advisor-evaluator 输出（最终结果）

每个技能启动前，检查上游状态文件是否存在并包含有效数据。

### 原则二：每个 Phase 结束后向用户汇报

Phase 1 完成后：
```
✅ Phase 1 完成：advisor-finder

找到 [N] 位候选导师，Top 10 按匹配分排序如下：
[简洁列出 Top 10：排名 | 姓名 | 院校 | 匹配分 | 招生状态]

→ 输出文件：advisor_shortlist_[日期].xlsx
→ 准备进入 Phase 2（导师深度背调）

[展示 advisor-detective 的启动确认提示，等待用户选择深度]
```

Phase 2 完成后：
```
✅ Phase 2 完成：advisor-detective

已调查 [N] 位导师，关键发现：
· 学术能力 Top 3：[姓名] ([分]分)、[姓名] ([分]分)、[姓名] ([分]分)
· 发现红旗：[N] 位导师有需注意信号（详见 Sheet 3）
· 评价信息不足：[N] 位导师无公开学生评价

→ 输出文件：advisor_detective_[日期].xlsx
→ 准备进入 Phase 3（综合评分）

[展示 advisor-evaluator 的权重确认提示，等待用户确认]
```

Phase 3 完成后：
```
✅ 全流水线完成！

🏆 综合排名 Top 5：
[排名 | 导师名 | 院校 | 综合分 | 评级]

→ 最终输出：advisor_final_ranking_[日期].xlsx
   · Sheet 1：综合排名（含 Excel 公式，可调整权重）
   · Sheet 2：每位导师决策建议
   · Sheet 3：分维度热力图
   · Sheet 4：权重调整器（可直接修改）

后续可进行：陶瓷信撰写（coming soon）
```

### 原则三：允许从任意 Phase 入口启动

用户可能已经完成了部分阶段：

| 用户说 | 行为 |
|--------|------|
| "从头开始" | 从 Phase 1 开始 |
| "我已经有 advisor-finder 的结果了，帮我做背调" | 直接进入 Phase 2，读取已有状态文件 |
| "背调完了，帮我综合打分" | 直接进入 Phase 3，读取 detective 文件 |
| "我只想用 advisor-finder" | 仅执行 Phase 1，说明其他 Phase 可选 |

---

## Phase 1：advisor-finder

**直接调用 advisor-finder 技能**，无需重复其逻辑。

Phase 1 入口检查清单：
- [ ] 用户是否已提供 CV？（必须）
- [ ] 目标（TARGET）是否明确？（必须）
- [ ] 研究兴趣权重是否已填写？（必须）
- [ ] 目标学位是否明确？（必须）

如有缺失，先收集这些信息再启动。

Phase 1 完成信号：`ADVISOR_STATE.md` 中 Phase 5 完成，`advisor_shortlist_*.xlsx` 已生成。

---

## Phase 2：advisor-detective

**直接调用 advisor-detective 技能**。

Phase 2 入口：
1. 读取 `ADVISOR_STATE.md` 中的 Scores 表，按加权总分降序取 Top N（默认 10）
2. 提取：导师名、院校、研究方向、主页URL、Scholar URL、匹配分、招生状态
3. 将列表传递给 advisor-detective 技能作为调查对象
4. 展示 advisor-detective 的启动确认提示

Phase 2 完成信号：`DETECTIVE_STATE.md` 所有导师状态为"完成"，`advisor_detective_*.xlsx` 已生成。

---

## Phase 3：advisor-evaluator

**直接调用 advisor-evaluator 技能**。

Phase 3 入口：
1. 确认 `advisor_shortlist_*.xlsx` 和 `advisor_detective_*.xlsx` 均已生成
2. 传入 advisor-detective 的深度信息（shallow/medium/high）以自动选择合适权重配置
3. 展示权重确认提示

Phase 3 完成信号：`EVALUATOR_STATE.md` 已记录最终排名，`advisor_final_ranking_*.xlsx` 已生成。

---

## 文件命名约定

所有文件保存在同一工作目录，命名格式：

```
ADVISOR_STATE.md              ← Phase 1 状态
DETECTIVE_STATE.md            ← Phase 2 状态
EVALUATOR_STATE.md            ← Phase 3 状态
advisor_shortlist_YYYYMMDD.xlsx       ← Phase 1 输出
advisor_detective_YYYYMMDD.xlsx       ← Phase 2 输出
advisor_final_ranking_YYYYMMDD.xlsx   ← Phase 3 输出（最终结果）
```

---

## 错误处理

| 错误情况 | 处理方式 |
|----------|---------|
| Phase 1 中 advisor-finder 只找到 < 5 位候选 | 提示用户扩大 TARGET 范围后继续 |
| Phase 2 某导师完全找不到公开信息 | 所有维度填"无信息"，但不跳过该导师 |
| Phase 3 输入文件导师名不对齐 | 手动对应，并在 EVALUATOR_STATE.md 中记录映射关系 |
| 用户中途中断 | 状态文件保留当前进度，下次可从中断处恢复 |

---

## 快速参考：技能文件路径

运行此流水线时依次调用以下技能：

1. `advisor-finder/SKILL.md` — 导师发现与匹配
2. `advisor-detective/SKILL.md` — 导师深度背调
3. `advisor-evaluator/SKILL.md` — 综合评分与最终排名

---

## 未来扩展（规划中）

- **Phase 4：陶瓷信撰写（Cold Email Writer）** — 根据综合排名 Top N 和套磁角度，自动生成个性化陶瓷信草稿
- **Phase 5：Research Proposal 辅助（RP Helper）** — 基于目标导师的研究方向，辅助写作 Research Proposal

*后续版本将在此 pipeline 中新增 Phase 4 和 Phase 5 入口。*

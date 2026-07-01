# 🎓 Find Your Perfect Advisor

**一站式 AI 导师匹配系统** — 从 CV 到最终导师综合排名，三阶段全自动流水线。

```
📄 你的 CV + 目标
       ↓
  [Phase 1] advisor-finder      发现候选导师 → 按研究方向匹配打分
       ↓  Top 10 导师
  [Phase 2] advisor-detective   深度背调 → 学术实力 + 潜力 + 人品
       ↓
  [Phase 3] advisor-evaluator   综合评分 → 最终排名 + 决策建议
       ↓
📊 advisor_final_ranking.xlsx   可直接用于陶瓷信决策
```

---

## 目录

1. [项目简介](#1-项目简介)
2. [安装 Claude Code](#2-安装-claude-code)
3. [安装技能（Skills）](#3-安装技能skills)
4. [四个技能详解](#4-四个技能详解)
5. [完整使用流程](#5-完整使用流程)
6. [分阶段独立使用](#6-分阶段独立使用)
7. [输出文件说明](#7-输出文件说明)
8. [常见问题](#8-常见问题)
9. [注意事项与免责声明](#9-注意事项与免责声明)

---

## 1. 项目简介

### 这个项目做什么

申请 PhD / MPhil / MS / 博后时，找到合适的导师是最关键也最耗时的步骤。这套工具将整个流程自动化：

- **不再手动刷 Google Scholar** — AI 自动搜索、筛选、评分
- **不再凭感觉判断导师** — 结构化评估学术实力、潜力、人品
- **不再信息不对称** — 汇聚小木虫、知乎、Scholar、主页等多源信息
- **不再纠结优先级** — 综合评分给你明确的"优先联系"排名

### 技能文件清单

| 文件 | 阶段 | 作用 |
|------|------|------|
| `skills/advisor-finder.skill` | Phase 1 | 导师发现与匹配打分 |
| `skills/advisor-detective.skill` | Phase 2 | 导师深度背景调查 |
| `skills/advisor-evaluator.skill` | Phase 3 | 综合评分与最终排名 |
| `skills/advisor-pipeline.skill` | 全程 | 三阶段流水线编排器（推荐入口） |

---

## 2. 安装 Claude Code

Claude Code 是 Anthropic 推出的命令行 AI 编程与任务工具，本套技能在 Claude Code 环境中运行。

### 第一步：安装 Node.js

Claude Code 需要 Node.js 18 或更高版本。

**macOS（推荐用 Homebrew）：**

```bash
# 安装 Homebrew（如已安装跳过）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Node.js
brew install node

# 验证
node --version   # 应显示 v18.x 或更高
```

**Windows：**

前往 [nodejs.org](https://nodejs.org) 下载 LTS 版本安装包，安装后在命令提示符中运行 `node --version` 验证。

**Linux（Ubuntu/Debian）：**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 第二步：安装 Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### 第三步：登录

```bash
claude
```

首次运行会打开浏览器要求你用 Claude.ai 账号登录并授权。完成后回到终端即可使用。

> **需要什么账号？** 需要 Claude Pro 订阅（$20/月）或 Claude for Teams/Enterprise 账号，免费版不支持 Claude Code。

### 第四步：验证安装

```bash
claude --version
# 应输出版本号，如：1.x.x
```

---

## 3. 安装技能（Skills）

技能（.skill 文件）是 Claude Code 的可安装扩展，提供专门的工作流指令。

### 方法一：通过 Cowork 界面安装（推荐）

如果你使用 Claude 桌面应用的 Cowork 模式：

1. 打开 Cowork 界面
2. 将 `.skill` 文件拖入聊天窗口，或点击文件卡片上的 **Save skill** 按钮
3. 依次安装四个技能文件

### 方法二：通过命令行安装

```bash
# 进入你存放项目的目录
cd ~/your-working-directory

# 安装技能（路径替换为你实际的文件位置）
claude skill install /path/to/find-your-perfect-advisor/skills/advisor-finder.skill
claude skill install /path/to/find-your-perfect-advisor/skills/advisor-detective.skill
claude skill install /path/to/find-your-perfect-advisor/skills/advisor-evaluator.skill
claude skill install /path/to/find-your-perfect-advisor/skills/advisor-pipeline.skill
```

### 验证安装

在 Claude Code 中输入：

```
/skills
```

应该能看到以下四个技能：
- `advisor-finder`
- `advisor-detective`
- `advisor-evaluator`
- `advisor-pipeline`

---

## 4. 四个技能详解

### 🔍 advisor-finder（Phase 1）

**功能：** 根据你的 CV 和研究兴趣，在目标学校/领域中发现并匹配候选导师。

**核心逻辑：**
- 解析你的 CV，提取学历、论文、技能、研究兴趣
- 搜索目标范围内的教授名单（官网、CSRankings、Google Scholar 等）
- 对每位导师进行深度 profiling（研究方向、近3年论文、招生状态）
- 按加权匹配分（0–10）排序，输出 Excel 工作簿

**需要你提供的信息：**
- CV 文件（PDF / MD / TXT）
- 目标范围（如"US Top 20 CS"、"HKUST(GZ) Information Hub"）
- 研究兴趣与权重（如：agent 0.4, reasoning 0.3, multimodal 0.3）
- 目标学位（PhD / MPhil / MS / Postdoc / RA）

**输出：**
- `ADVISOR_STATE.md`（状态文件，供下游技能读取）
- `advisor_shortlist_[日期].xlsx`（6个 Sheet 的完整工作簿）

---

### 🕵️ advisor-detective（Phase 2）

**功能：** 对 Top N 位导师进行深度背景调查，输出结构化评估报告。

**三档深度：**

| 深度 | 评估内容 | 适用场景 |
|------|---------|---------|
| **Shallow** | 学术硬实力（H指数、发文量、顶会/顶刊数、学生去向） | 快速筛查，预选30→10 |
| **Medium** | Shallow + 学术潜力（发文趋势、新方向） + 导师人品（学生评价、红旗信号、毕业时长） | 重点候选人深入了解 |
| **High** | Medium + 荣誉/奖项、业界合作、对国际生态度、近期重大动态 | 最终定向前全面背调 |

> ⚠️ **重要：** 启动前会显示 token 消耗警告并要求你手动确认深度，High 深度对 10 位导师的搜索轮次较多，请做好心理准备。

**评分维度（所有导师统一，无信息填"无信息"）：**
- 学术能力评分（0–10）
- 学术潜力评分（0–10，Medium+ 才有）
- 导师人品评分（0–10，Medium+ 才有）
- 深度背调评分（0–10，High 才有）

**输出：**
- `DETECTIVE_STATE.md`（状态文件）
- `advisor_detective_[日期].xlsx`（主表 + 评价证据库 + 红旗预警 + 数据来源）

---

### 🏆 advisor-evaluator（Phase 3）

**功能：** 将 advisor-finder 的匹配分和 advisor-detective 的各维度评分合并，计算最终综合评分并生成决策建议。

**默认权重（可自定义）：**

| 维度 | 默认权重 |
|------|--------|
| 研究方向匹配度 | 40% |
| 学术硬实力 | 30% |
| 学术潜力 | 20% |
| 导师人品 | 10% |

> 技能会根据 advisor-detective 的深度自动调整：Shallow 深度时退化为匹配度 50% + 硬实力 50%。

**输出 Excel 亮点：**
- Sheet 1 综合排名内嵌 SUMPRODUCT 公式，修改 Sheet 4 权重后排名自动刷新
- 每位导师生成评级：⭐⭐⭐ 强烈推荐 / ⭐⭐ 推荐 / ⭐ 可考虑 / ⚠️ 谨慎 / ❌ 不推荐
- 每位导师生成决策卡：核心优势 + 主要风险 + 建议行动

**输出：**
- `EVALUATOR_STATE.md`（状态文件）
- `advisor_final_ranking_[日期].xlsx`（最终排名 + 决策建议 + 热力图 + 权重调整器）

---

### 🎓 advisor-pipeline（流水线编排器）

**功能：** 统一入口，自动串联以上三个技能，管理阶段间的状态传递。

**使用场景：**
- 想从头走完整个流程：直接用 pipeline
- 只想用某一阶段：分别调用对应技能

---

## 5. 完整使用流程

### 准备工作

1. 安装好 Claude Code 和四个技能（见第 2、3 节）
2. 准备你的 CV 文件（推荐 PDF 格式）
3. 想清楚你的研究兴趣和目标范围

### 在 Claude Code 中开始

```bash
# 进入你的工作目录（输出文件会保存在这里）
mkdir ~/phd-advisor-search
cd ~/phd-advisor-search

# 启动 Claude Code
claude
```

### 触发流水线

对 Claude 说：

```
帮我找导师，我想走完整个导师匹配流水线。我的 CV 在 [路径/cv.pdf]。
```

或者更直接：

```
开始导师匹配流程
```

Claude 会自动触发 **advisor-pipeline** 技能，引导你完成以下步骤：

---

### Phase 1 详细步骤

**Claude 会先问你：**

```
请提供以下信息：
1. CV 文件路径（或直接粘贴内容）
2. 目标范围（学校/地区/排名）
3. 研究兴趣与权重
4. 目标学位
```

**你的回答示例：**

```
1. CV：~/documents/cv.pdf
2. 目标：美国 CS 前 20（CMU、Stanford、MIT、Berkeley、UIUC 等）
3. 研究兴趣：LLM agent 0.4，reasoning 0.3，multimodal 0.2，code generation 0.1
4. 学位：PhD
```

**等待时间：** 约 15–30 分钟（取决于目标范围大小）

**Phase 1 完成后 Claude 会汇报：**

```
✅ Phase 1 完成

找到 47 位候选导师，Top 10 按匹配分：
#1  Jane Smith     MIT / CSAIL          9.2分  ✅
#2  John Doe       Stanford / CS        8.8分  ✅
#3  Wei Zhang      CMU / LTI            8.5分  ❓
...

→ 输出文件：advisor_shortlist_20250701.xlsx

准备进入 Phase 2（深度背调）。请选择调查深度：
shallow / medium / high（默认调查 Top 10）
```

---

### Phase 2 详细步骤

**你回复：**

```
medium，调查 Top 10
```

**Claude 展示确认提示（你需要明确回复"确认"）：**

```
⚠️ 调查将消耗较大量 token，确认后开始。
深度：medium | 人数：10 | 额外关注：无
请回复"确认开始"继续。
```

**等待时间：** Medium 深度约 30–60 分钟

**Phase 2 完成后 Claude 汇报：**

```
✅ Phase 2 完成

关键发现：
· 学术能力 Top 3：Jane Smith (9.1)、Wei Zhang (8.7)、John Doe (8.3)
· 发现红旗：1 位导师有学生投诉记录（详见 Sheet 3）
· 评价信息不足：3 位导师无公开学生评价

→ 输出文件：advisor_detective_20250701.xlsx
准备进入 Phase 3（综合评分）
```

---

### Phase 3 详细步骤

**Claude 展示权重确认：**

```
默认权重：匹配度 40% + 硬实力 30% + 潜力 20% + 人品 10%
是否使用默认权重？（是/否）
```

**你回复：**

```
是
```

**等待时间：** 约 5–10 分钟

**Phase 3 完成后 Claude 汇报：**

```
✅ 全流水线完成！

🏆 综合排名 Top 5：
#1  Jane Smith     MIT         9.0分  ⭐⭐⭐ 强烈推荐
#2  Wei Zhang      CMU         8.4分  ⭐⭐   推荐
#3  John Doe       Stanford    7.9分  ⭐⭐   推荐
...

→ 最终文件：advisor_final_ranking_20250701.xlsx
```

---

## 6. 分阶段独立使用

如果你只需要某一阶段，可以单独触发对应技能：

**只用 advisor-finder：**
```
帮我找 [目标] 的导师，研究方向是 [XXX]，只需要匹配排名，不需要背调。
```

**只用 advisor-detective（已有导师名单）：**
```
我已经有一个导师名单了，帮我对这些导师做深度背调：
1. Jane Smith - MIT - https://xxx
2. John Doe - Stanford - https://xxx
...
```

**从 Phase 2 继续（已有 Phase 1 结果）：**
```
我已经完成了 advisor-finder，状态文件在 ADVISOR_STATE.md，
帮我继续做 Phase 2 深度背调，deep 深度。
```

---

## 7. 输出文件说明

### advisor_shortlist_[日期].xlsx（Phase 1 输出）

| Sheet | 内容 |
|-------|------|
| 1_加权评分排序 | 所有候选导师按匹配分排序，含各研究方向子分 |
| 2_详情对照 | 每位导师的详细信息（论文、方向、邮箱、招生状态） |
| 3_套磁优先级 | 推荐套磁顺序 + 套磁角度建议 |
| 4_邮件模板 | 中英文套磁信模板框架 |
| 5_说明·权重·来源 | 评分说明 + 数据来源 + 免责声明 |
| 6_入手论文 | 每位导师的推荐阅读论文列表 |

### advisor_detective_[日期].xlsx（Phase 2 输出）

| Sheet | 内容 |
|-------|------|
| 导师调查汇总 | 所有维度对齐的主表（每位导师同一套列） |
| 学生评价证据库 | 各平台收集到的原始评价摘录 |
| 红旗预警 | 有负面信号的导师及具体描述 |
| 数据来源日志 | 所有信息的来源 URL 和查询日期 |

### advisor_final_ranking_[日期].xlsx（Phase 3 输出）⭐ 最终结果

| Sheet | 内容 |
|-------|------|
| 最终综合排名 | 综合评分排名，内嵌公式，可动态调整 |
| 决策建议卡 | 每位导师：核心优势 + 风险 + 建议行动 |
| 分维度热力图 | 各维度对比，红绿渐变，快速识别强弱项 |
| 权重调整器 | 直接修改此处权重，Sheet 1 排名自动刷新 |
| 数据汇总来源 | 完整数据来源记录 |

---

## 8. 常见问题

**Q：advisor-finder 找不到某个学校的教授怎么办？**

A：部分学校官网是 JavaScript 渲染的（SPA），直接抓取会失败。可以告诉 Claude "用 Google 搜索补充 [学校名] [方向] faculty"，或者安装 Claude in Chrome 插件让 Claude 直接浏览渲染后的页面。

**Q：Phase 2 中某位导师完全没有公开信息怎么办？**

A：这种情况技能会照常输出该导师的行，所有维度填"无信息"，不会跳过。导师人品评分会标注"信息不足（5分/10分，中性）"。

**Q：token 消耗大概是多少？**

A：粗估参考（实际取决于目标范围大小和网页内容量）：
- Phase 1（25位导师）：约 100k–300k tokens
- Phase 2 Shallow（10位）：约 50k–100k tokens
- Phase 2 Medium（10位）：约 150k–250k tokens
- Phase 2 High（10位）：约 300k–500k tokens
- Phase 3：约 20k–50k tokens

**Q：中途断了怎么继续？**

A：三个技能都维护状态文件（`ADVISOR_STATE.md`、`DETECTIVE_STATE.md`、`EVALUATOR_STATE.md`），告诉 Claude "状态文件在 XXX，从 [导师名] 继续" 即可恢复。

**Q：可以只调查我自己找的导师，不用 Phase 1 吗？**

A：可以，直接触发 advisor-detective 并提供导师名单即可。参见"分阶段独立使用"。

**Q：输出语言是中文还是英文？**

A：三个技能都支持中文、英文、双语输出，默认跟随你的对话语言。如需指定，可在开始时说"Excel 输出用英文"或"双语输出"。

**Q：学生评价找不到（尤其是海外导师）？**

A：海外导师评价较难找，Rate My Professors 覆盖范围有限，Reddit / Twitter 可补充。技能会如实标注"无公开学生评价"而不是猜测。

---

## 9. 注意事项与免责声明

### 使用建议

- **从 advisor-finder 结果看招生状态** — 带 ❌ 标签的导师本年度已明确停招，联系意义不大
- **Phase 2 建议 medium 深度起步** — Shallow 遗漏了人品维度，直接影响是否值得花时间写陶瓷信
- **评分是辅助判断，不是最终答案** — 评分低不代表导师不好，可能只是公开信息少；高分导师也需要你自己判断风格是否合适
- **结果时效性** — 导师信息随时间变化（换校、停招、方向转型），建议在发送陶瓷信前再次手动确认关键信息

### 免责声明

本工具通过公开可获取的信息进行分析，所有数据来源于学术数据库、个人主页、公开论坛等。

- **招生状态、职位、研究方向可能随时变化**，本工具的评估结果不代表最终招生决定
- **学生评价来自网络论坛**，存在主观性和信息偏差，请结合多方信息判断
- **综合评分为辅助工具**，最终申请决策应由你自行做出
- **本工具不收集你的 CV 或个人信息**，所有数据仅在你的本地会话中处理

如发现信息有误或需要更新，建议直接访问导师的官方主页或联系学院招生办公室核实。

---

## 后续规划

- **Phase 4：陶瓷信撰写（Cold Email Writer）** — 根据综合排名和套磁角度，一键生成个性化陶瓷信草稿
- **Phase 5：Research Proposal 辅助（RP Helper）** — 基于目标导师方向，辅助写作 Research Proposal

---

*Find Your Perfect Advisor — 让 AI 替你做信息搜集，让你把时间花在真正重要的事上。*

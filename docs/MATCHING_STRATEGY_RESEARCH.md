# 导师匹配策略调研与实现决策

调研日期：2026-09-04

## 结论

导师匹配不应该被压成一个“相似度分数”。更可靠的流程是：

`申请路径识别 → 硬条件门槛 → 研究匹配 → 履历匹配 → 当前机会证据 → 组合分层 → 路径化行动 → 反馈迭代`

其中任何未知项都必须保留为未知；综合分不是录取概率，也不能覆盖硬条件失败。

## 中介通常怎么做

多家公开服务说明呈现出相近的流水线：先审查 GPA、学位、研究经历、论文、工作与语言等申请者资料，再按 dream/target/safe 建候选组合；之后补充导师近期研究、经费、实验室规模、项目难度、申请材料和截止日期，最后做套磁、文书、进度跟踪和面试准备。[PhdAdmit](https://phdadmit.com/) 将这一过程明确拆成 profile audit、shortlist/matching、outreach、documents、tracking 和 interview；[新东方学术影响力计划](https://liuxue.xdf.cn/special_usayjs/xm_xuezhe/index.html) 也强调多维背景评估、论文分析、方向定位以及结合项目难度和课程设置。

另一些中介建议优先关注助理教授、活跃或有经费信号的导师，并根据回复率分批调整套磁。[新东方套磁指南](https://liuxue.xdf.cn/blog/blog_7967033.shtml) 展示了这种实务启发，但其中“同国籍/校友更容易回复”“年轻导师等于机会”等判断不能当作可靠证据，更不能成为产品的自动排序特征。

可借鉴的是流程纪律，而不是营销数字或人群代理变量：

- 借鉴：申请者画像、分层候选、近期工作与经费核验、分批行动、回复/面试后的迭代。
- 拒绝：未经验证的成功率、单一录取概率、按国籍/族裔/年龄/职称加分、用学校名气替代申请者匹配。

## 为什么必须先识别申请路径

官方申请规则并不统一。UCL 的导师联系指南建议从人员主页和论文库核验当前研究，并发送针对性的研究计划和 CV；其研究型项目申请页也要求检查导师可用性、入学条件、经费与截止日期。[UCL 联系导师指南](https://www.ucl.ac.uk/population-health-sciences/global-health/study/postgraduate-research-degrees/guidance-contacting-potential-supervisors) [UCL 研究型申请指南](https://www.ucl.ac.uk/study/prospective-students/graduate/how-apply/applying-graduate-research-study-ucl)

但 Stanford Political Science 明确说明申请由委员会处理、申请人是录取到项目而非某位导师，提前联系教师不是必需或预期行为；Stanford GSE 也说明联系教师并非申请要求，且不保证录取。[Stanford Political Science FAQ](https://politicalscience.stanford.edu/graduate-program/faq-prospective-phd-students) [Stanford GSE FAQ](https://ed.stanford.edu/content/do-i-have-contact-stanford-gse-faculty-members-i-apply)

ETH Zurich 说明许多博士机会由教授以职位方式招聘；DAAD 则区分个人导师制与结构化博士项目。[ETH Zurich 博士职位指南](https://ethz.ch/en/doctorate/finding-a-place.html) [DAAD 博士路径指南](https://www.daad.de/en/studying-in-germany/phd-studies-research/ways-to-your-phd/)

因此，同一个“导师不回复”在不同路径下含义完全不同：导师主导项目可能需要继续核验或调整联系策略；委员会主导项目不应因此判成没机会；公开岗位应按职位要求申请；结构化项目应走项目入口。

## 新匹配契约

### 1. 硬门槛

用户明确的地区、排除国家、学位、排名范围、学费或 funding 要求先执行。每个导师—项目组合只有 `pass / fail / unknown`；证据不足只能是 `unknown`。
若用户没有设置任何额外硬条件，确定性脚本直接把这一门槛视为通过，不会凭空制造核验任务。

### 2. 四类申请路径

- `supervisor_led`：先联系导师。
- `committee_led`：走项目申请，套磁不是决定性门槛。
- `advertised_position`：关联具体在招岗位；已关闭则排除，未开放则监测。
- `structured_program`：走博士项目/学院入口。
- 无法确认时为 `unknown`，下一步是核实路径。

若路径已确认但硬条件或客观资格仍未知，下一步先核实对应条件，不能提前显示“申请”或“联系导师”。

### 3. 分开的匹配维度

- `fit`：近期研究方向与方法的契合度。
- `profileMatch`：申请者已有方法、论文、项目、先修条件与可迁移能力。
- `opportunityStatus`：当前官方开放、仅有信号、未知或已关闭。
- `competitiveness`：冲刺/主申/相对稳妥/未知，只用于申请组合。
- `overallMatch`：脚本固定按 `60% 研究匹配 + 40% 履历匹配` 计算并保留一位小数，不是录取概率。硬条件、客观资格与机会证据单独显示，不藏进分数。

### 4. 确定性组合选择

候选池完成后，由脚本统一执行硬排除、稳定排序、shortlist 数量和 reach 上限，并保存被排除候选及审计。默认 balanced 的 reach 上限约 30%，conservative 约 20%，ambitious 约 50%；若真实池不足以满足比例，输出偏离原因，不凑“稳妥”候选。

### 5. 后续可迭代信号

回复、面试和正式申请结果可以在未来作为同一申请者的流程反馈，用于调整材料或候选组合；在没有足够校准样本前，不能把它们包装成普适录取概率模型。

## 兼容性与故障面

| 组件 | 原风险 | 当前处理 |
| --- | --- | --- |
| 旧 `project.json` | 没有硬条件和组合策略 | schemaVersion 8 迁移，缺失字段使用空字符串和 balanced |
| 旧 `candidates.json` | 缺少新分数/路径字段 | 分数保持 `null`，分类保持 `unknown`，不转换成 0 |
| Finder 输出 | Agent 可能绕过 reach 上限或丢掉排除项 | 强制确定性脚本和 `matching-audit.json` 产物校验 |
| 重跑匹配脚本 | 已选名单会覆盖上一轮排除记录 | 识别已筛选重跑并合并旧 excluded；新候选池不混入旧记录 |
| Web 候选表 | 单一匹配分掩盖不同概念 | 分列展示研究、履历、综合、硬条件、路径和下一步 |
| CLI 选择菜单 | 与 Web 字段不一致 | 展示相同匹配与路径字段，旧值显示为破折号/unknown |
| Finder Excel | `Number(null)` 会把未知写成 0 | 显式保留空白，并新增路径/机会/硬条件列 |
| Evaluator Excel | 旧优先级只依赖研究分和可行性 | 先排除硬失败/不合格/已关闭，再按未知状态和组合定位决定 |
| 最终排名页 | Evaluator 漏写新字段时前端丢失信息 | 按稳定 ID 从 Finder 候选继承，再由 ranking 显式值覆盖 |

## 不做的承诺

本策略改善的是筛选顺序、证据边界、申请组合和下一步行动，不声称已经提高录取率。要验证真实效果，需要在用户授权下长期记录候选、联系批次、回复、面试和结果，并控制项目路径、地区、申请季和申请者背景差异。

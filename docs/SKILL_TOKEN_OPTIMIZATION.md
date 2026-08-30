# Skill 与 Pipeline Token/计算消耗审计

日期：2026-08-30

## 审计范围

逐份检查了六个入口 Skill（Finder、Detective、Evaluator、Pipeline、Research
Proposal、Outreach）、全部 Markdown reference、确定性菜单/确认/初始化/工作簿/
文献下载/材料校验脚本，以及 Web runtime 的 Agent 提示构造、项目 Skill 同步和
阶段完成校验。

本轮唯一目标是减少运行期 token 与无效计算；稳定 ID、真实 CV、用户确认、证据
等级、官方申请条件、隐私边界、文献全文与哈希校验、PDF 视觉 QA、禁止自动发送/
提交等质量和安全契约不降级。

## 全部候选任务与风险

| ID | 浪费点 | 方案 | 风险 | 决策 |
| --- | --- | --- | --- | --- |
| T01 | 五种 Web mode 每次都注入同一份 15 条全流程大提示 | 公共最小约束 + mode 专属约束 | 拆分时漏掉当前阶段约束 | 已实施；逐 mode 行为测试锁定 |
| T02 | Web 所有 mode 先指向 Pipeline，再由 Pipeline 转到子 Skill | 直接指向 Finder/Detective/Evaluator/RP/Outreach | 绕过阶段门禁 | 已实施；门禁仍由 runtime readiness/confirmation 强制 |
| T03 | `data-contract.md` 317 行被多个阶段整份读取 | 改为短路由 + core/Detective/material 三个按需契约 | 内容迁移遗漏、链接失效 | 已实施；保留原有字段/状态/迁移/确认不变量并检查链接 |
| T04 | RP 三个 reference 无条件全读；Detective 无论选择什么都读 11 维详情 | 按当前动作和已选 section 加载 | 路由判断错导致漏读 | 已实施；最终稿/产物前仍强制相应 reference |
| T05 | 运行 reference 携带只用于设计溯源的长 URL/研究依据 | 运行时只保留操作规则；设计依据留在 `docs/OUTREACH_RP_RESEARCH.md` | 规则失去来源 | 已实施；来源文档仍保留 |
| T06 | 文献 downloader 在 manifest 与本地 PDF 未变化时仍重复下载 | URL/公开依据/路径/bytes/SHA-256 全匹配才复用；提供 `--refresh` | 远端同 URL 内容更新但未主动刷新 | 已实施；显式刷新，任一完整性不匹配自动重下 |
| T07 | Finder/Detective 仍由 Agent 自行归纳 missing/stale/conflict 查询计划 | 新增确定性 query planner | planner 漏字段会直接漏检 | 暂缓；需先定义完整字段级 freshness 策略 |
| T08 | 每次运行把全部 Skills 复制到 `.agents` 和 `.claude` | 源/目标内容指纹一致时跳过复制 | 用户局部修改或损坏可能未被修复 | 暂缓；仅节省少量本地 I/O，不值得增加一致性风险 |
| T09 | 减少官方名册、来源、全文检查、选中维度覆盖或 PDF QA | 直接减少检索/验证 | 明确改变 Skill 效用和证据质量 | 拒绝实施 |
| T10 | Agent 发现 CV 不真实后，Web 会过滤 `input.requested.cv` 并把任务标成 partial | 将 `cv` 作为结构化补充类型，在原会话上传并继续 | 把文件路径当普通文本会破坏上传边界 | 已实施；专用文件控件先保存项目 CV，再续接同一 run/thread |
| T11 | CLI 脚本从 `/tmp` 或其他软链接路径启动时静默退出 0 | 主入口比较 canonical realpath | 路径不存在时 realpath 失败 | 已实施；不存在路径回退绝对路径，并用软链接与 macOS `/tmp` 实测 |
| T12 | 同一次 MCP/HTTP 波动在主进度区重复显示多条重试警告 | 保留最新累计警告，其余进技术日志 | 隐藏持续故障 | 已实施；仍显示最新次数，不隐藏最终 error 或正常进度 |

## 已实施的低风险方案

### 1. Mode-aware runtime prompt

旧提示模板源码约 6,192 字符，且每个阶段都包含候选 schema、Detective 快照、
社区缓存、材料快照、文献下载和 RP/邮件交付规则。新提示按 mode 生成：

| Mode | 新提示字符数（固定测试样例） | 相对旧模板字符下降 |
| --- | ---: | ---: |
| Finder | 1,507 | 约 76% |
| Detective | 1,108 | 约 82% |
| Ranking | 718 | 约 88% |
| Research Proposal | 1,349 | 约 78% |
| Outreach | 1,228 | 约 80% |

字符数不是精确 tokenizer 账单，但在同语言、同模型下可稳定反映输入 token 的数量级。
这里测量的是 Web 实际任务提示与 runtime 阶段提示合并后的完整文本，而不是只测
runtime 单元。前端只表达任务意图；Skill 路由、确认快照、schema 与安全契约由
runtime 注入一次。新提示不再包含其他阶段 payload，也不再先要求读取 Pipeline。

### 2. 单 Skill progressive disclosure

典型阶段所需的 shared-contract 词数从 1,287 词的全量文件变为：短路由 196
词、core 611 词、Detective 290 词或材料契约 918 词，并且只加载当前阶段所需
部分。以完整常见路径估算：

- Finder（含客观筛选）shared/phase reference 从约 1,610 词降到约 934 词。
- Evaluator shared/workbook reference 从约 1,573 词降到约 897 词。
- Detective 不再为未选择的维度加载完整说明；社区 reference 仍只在相关维度被
  选择时读取。
- RP 的早期问题收窄不再读取 LaTeX/PDF 交付规则；纯格式构建不重复加载文献检索
  方法。最终完整 RP 仍会依次读取全部必要 gate。

### 3. 重复下载消除

文献复用不是“相信缓存”：每次仍读取本地文件并核对 PDF 头、长度与 SHA-256，
同时要求 manifest 中路径、canonical URL、download URL 和公开获取依据一致。只有
全部通过才跳过网络下载。显式 `--refresh` 强制重新获取。

### 4. 无效整轮重跑消除

Finder 若发现 CV 缺失、不可读或明确为测试材料，会发出 `input.requested` 的 `cv`
字段。Web 现在显示专用上传控件，文件保存成功后调用原 run 的 continue endpoint；
不会新建 run 或 Agent thread。实测同一 run 先后两次拒绝合成 CV，中间只有一次
`run.continued`，全程只有一个 `thread.started`。

### 5. CLI 与日志修复

七个直接执行脚本共用 canonical-path 主入口判断，避免 `/tmp -> /private/tmp` 或
Skill 目录软链接导致“退出码 0、无输出、无文件”的静默失败。连接重试在主进度中
折叠为一条最新累计提示，真实错误和技术详情仍保留。

## 风险控制

- Runtime readiness 继续在 Agent 启动前检查当前 mode 的输入、确认版本和执行顺序。
- Detective 与材料产物继续绑定确认 revision/fingerprint；旧产物不能冒充本轮完成。
- 新提示测试同时断言“必须包含的当前阶段约束”和“不得出现的其他阶段 payload”。
- Skill frontmatter、相对链接、JavaScript lint、单元/集成测试与完整构建均作为交付门槛。
- 真实 Web 冒烟确认 Agent 只加载 `advisor-finder`；合成 CV 被正确拒绝并进入
  `needs_input`，替换文件后沿用原 run 与 Codex thread。
- 未实施任何降低名册覆盖、来源数量、已选维度覆盖或材料验证强度的方案。

## 后续若继续优化

下一项应是 T07，但只有在能从现有 field state、source freshness 和目标 intake
确定性生成完整查询计划，并用“不能漏掉任何 missing/stale/conflict 字段”的 fixture
覆盖后才值得实施。否则节省的搜索 token 不足以抵消漏检风险。

# Advisor Atlas · Find Your Perfect Advisor

AI 导师匹配工具：从真实 CV 和申请目标出发，完成候选导师发现、背景调查与最终排名。

本项目只有两种使用方式：

| 使用方式 | 适合谁 | 在哪里操作 |
|---|---|---|
| **方式一：Web 本地控制台** | 希望用图形界面填写资料、选择模型并查看进度 | 浏览器中的 `http://localhost:3000/` |
| **方式二：在自己的项目文件夹中直接使用 Skills** | 习惯 Codex Desktop、Codex CLI 或 Claude Code，希望由 Agent 直接管理文件 | 自己创建的本地申请项目文件夹 |

两种方式使用的是同一组导师匹配 Skills。区别只是由 Web 前端驱动，还是直接让 Codex / Claude 在项目文件夹中调用 Skills。

> 第一次使用或准备修改前端时，请先阅读 [Advisor Atlas 前端使用与维护指引](docs/FRONTEND_GUIDE.md)。
>
> **当前推荐使用方式：** Web 本地控制台仍在持续迭代，暂时可能存在界面或流程稳定性问题。现阶段更推荐使用 **Codex Desktop** 打开自己的申请项目文件夹，或者在该文件夹中通过 **Codex CLI / Claude Code** 直接调用项目级 Skills；完整结果会保存在项目本地文件夹中。

```text
真实 CV + 申请目标
        ↓
候选导师发现与匹配
        ↓
重点导师背景调查
        ↓
综合评分与最终决策
```

## 方式一：使用 Web 本地控制台

Web 模式适合不想一直在终端里操作的用户。你可以在页面中创建申请项目、上传 CV、填写研究兴趣、选择模型并查看运行进度。

### 1. 本地登录 Codex 或 Claude

Web 前端本身不提供 Codex 或 Claude 账号登录。请先在自己的电脑上安装并登录至少一个本地执行工具：

```bash
# 检查 Codex
codex --version
codex login

# 检查 Claude Code
claude --version
claude
```

只需要 Codex 或 Claude Code 其中一个可用。登录完成后，Web 控制台会自动检测本机状态。

> Web 控制台也保留自定义 API 高级选项，但这仍属于 Web 使用方式，不是第三种运行模式。

### 2. 启动 Web 控制台

```bash
cd web
npm install
npm run dev
```

然后打开：

- Web 控制台：<http://localhost:3000/>
- 本地桥接服务：<http://127.0.0.1:4318/>

`npm run dev` 会同时启动前端和本地桥接服务。停止时在启动它的终端按 `Ctrl+C`。

运行环境要求 Node.js 22.13 或更高版本。

### 3. 在网页中开始

1. 点击“新建申请项目”，填写项目名称。
2. 填写目标院校或地区范围。
3. 上传真实 CV，或填写至少一个研究兴趣；权重可留空。
4. 选择 Phase 1 希望保留的导师数量，默认 Top 10。
5. 保存申请资料。
6. 随时选择本机已登录的 Codex 或 Claude Code。
7. 点击“开始寻找导师”。
8. 最迟在 shortlist 的客观申请条件筛选前补齐目标学位和申请季。
9. 选择重点导师，并勾选需要的背景调查维度。
10. P2 显示“已完成”后直接查看背调结果；需要补充维度时再重新运行。
11. 生成综合排名。网页只展示前三名，完整信息在当前项目 `outputs/` 下自动生成的 Excel 中。

Phase 1 的最低输入未完成前，网页和后端只阻止启动任务，不阻止用户先选择模型。候选导师、背调证据和最终排名在任务真正开始前均为 `0`，不会显示演示结果。

Agent 需要执行命令、修改文件或申请网络权限时，网页会暂停并显示结构化授权卡片。用户可选择“允许一次”“本次运行允许”或“拒绝”，无需切回终端回答 CLI 提示。

### Web 模式支持的模型

| 模型来源 | 使用方式 |
|---|---|
| Codex | 先在本机完成 Codex CLI 登录，控制台自动检测 |
| Claude Code | 先在本机完成 Claude Code 登录，控制台自动检测 |
| 自定义 API（高级） | 填写 Base URL 和 Key，读取模型列表后选择精确模型 ID |

自定义接口需要兼容 OpenAI Responses API，并提供 `GET /models`。API Key 只保存在当前本地桥接进程的内存中，服务重启后需要重新连接。

### Web 项目放在哪里

Web 创建的申请项目默认位于仓库根目录的 `projects/`：

```text
projects/
└── application-20260726-135030-abcd/
    ├── project.json
    ├── status.json
    ├── inputs/
    │   └── <上传的 CV>
    ├── outputs/
    │   ├── candidates.json
    │   ├── advisor_records.json
    │   ├── program_records.json
    │   └── evidence.json
    ├── community-cache/       # 仅在明确同意后生成
    ├── runs/
    │   └── <run-id>/
    ├── .agents/
    │   └── skills/
    └── .claude/
        └── skills/
```

网页创建项目时只需填写项目名称，后端会自动生成文件夹 ID。不同申请项目不会共用 CV、状态或运行记录。

- `project.json`：申请季、目标范围、研究兴趣、精确导师选择和调查维度
- `status.json`：当前工作流阶段和结果数量
- `inputs/`：上传的 CV
- `outputs/`：候选名单、工作簿和报告
- `community-cache/`：用户明确同意后下载的本地第三方社区资料，可在页面中清除
- `runs/`：每次执行的元数据与事件
- `.agents/skills/`：Codex 项目级 Skills
- `.claude/skills/`：Claude Code 项目级 Skills

`projects/` 和 `.advisor-atlas/` 已加入 Git 忽略列表，避免把个人申请材料和本地运行配置误提交到仓库。

申请资料和任务结果保存在本地项目目录；执行任务时，本次任务需要的内容会由你选择的模型服务处理。

## 方式二：在自己的项目文件夹中直接使用 Skills

这种方式不需要启动 Web 前端。你自己创建一个申请项目文件夹，把 CV 和 Skills 放进去，然后让 Codex 或 Claude 直接在该文件夹中工作。

这里的 Desktop 主要指 Codex Desktop；Claude 侧使用 Claude Code 在项目文件夹中运行。

### 1. 创建自己的申请项目文件夹

```bash
mkdir -p ~/Documents/my-advisor-application
cd ~/Documents/my-advisor-application
```

把 CV、目标学校说明或其他申请资料放进这个文件夹。例如：

```text
my-advisor-application/
├── My_CV.pdf
└── application_notes.md
```

每个申请项目都应该使用不同文件夹，例如：

```text
Documents/
├── 2027-us-hci-phd/
├── 2027-europe-ai-phd/
└── postdoc-health-ai/
```

这样不同项目的 CV、候选导师、状态文件和输出结果不会混在一起。

### 2. 选择让 Codex 或 Claude 使用 Skills

#### 选择 Codex

把完整 Skills 复制到项目的 `.agents/skills/`：

```bash
mkdir -p ~/Documents/my-advisor-application/.agents/skills
cp -R /path/to/find-your-perfect-advisor/skills/* \
  ~/Documents/my-advisor-application/.agents/skills/
```

复制后的结构：

```text
my-advisor-application/
├── My_CV.pdf
└── .agents/
    └── skills/
        ├── advisor-finder/
        ├── advisor-detective/
        ├── advisor-evaluator/
        └── advisor-pipeline/
```

然后选择一种打开方式：

- 在 Codex Desktop 中打开 `my-advisor-application` 文件夹。
- 或者在终端中进入该文件夹后运行 `codex`。

```bash
cd ~/Documents/my-advisor-application
codex
```

#### 选择 Claude Code

把完整 Skills 复制到项目的 `.claude/skills/`：

```bash
mkdir -p ~/Documents/my-advisor-application/.claude/skills
cp -R /path/to/find-your-perfect-advisor/skills/* \
  ~/Documents/my-advisor-application/.claude/skills/
```

复制后的结构：

```text
my-advisor-application/
├── My_CV.pdf
└── .claude/
    └── skills/
        ├── advisor-finder/
        ├── advisor-detective/
        ├── advisor-evaluator/
        └── advisor-pipeline/
```

然后在终端中进入项目并启动 Claude Code：

```bash
cd ~/Documents/my-advisor-application
claude
```

#### 同一个项目同时支持 Codex 和 Claude

如果你希望之后可以自由切换，可以同时保留两套项目级目录：

```text
my-advisor-application/
├── My_CV.pdf
├── .agents/skills/    # Codex 使用
└── .claude/skills/    # Claude Code 使用
```

两边都复制完整 Skills，不要只复制 `SKILL.md`。`advisor-finder` 目录还包含生成工作簿所需的脚本。

### 3. 在 Codex 或 Claude 中调用 Skill

打开项目文件夹后，直接输入：

```text
使用 advisor-pipeline 开始导师匹配。

先读取当前项目中的真实 CV，并检查：
1. 目标学校或目标范围
2. 研究兴趣与权重
3. 目标学位
4. 申请季

如果缺少信息，请先询问我，不要编造。

Phase 1 完成后不要自动选择 Top N 进入背调。请像 Web 前端一样：
1. 展示可选择的真实导师—项目组合；
2. 展示全部调查维度，并默认选择前三项；
3. 让我选择导师和调查维度；
4. 如涉及导师风评，单独询问是否允许本地社区资料；
5. 展示预计消耗和最终配置，得到我确认后再开始 Phase 2。
```

首次直接运行时，`advisor-pipeline` 会在当前文件夹初始化与 Web
兼容的 `project.json`、`status.json` 和 `outputs/`。CLI 与 Web 使用同一套
结构化状态和三阶段流程，区别只在于 CLI 用编号菜单代替网页复选框。

Phase 1 完成后，CLI 会显示类似下面的选择门：

```text
导师—项目组合：
[1] Prof. A｜University A｜PhD in CS｜匹配 8.9｜eligible
[2] Prof. B｜University B｜PhD in HCI｜匹配 8.3｜needs_confirmation

调查维度：
[1] 基础身份与当前职位（默认）
[2] 最近三年研究兴趣与方向（默认）
[3] 近期项目与招生状态（默认）
[4-11] 其余可选维度

回复示例：
导师：1,2
维度：保留默认，并增加 5,6,10
社区资料：不允许
```

Agent 必须在显示精确导师、维度、预计消耗和社区资料授权的最终摘要后
等待确认。菜单操作只保存草稿；只有最终确认才生成可供 Phase 2 使用的
确认快照。只给人数、导师姓名或“Top N”不能代替精确选择。

也可以只调用某个阶段：

```text
使用 advisor-finder 帮我寻找候选导师。
```

```text
使用 advisor-detective 对候选导师进行背景调查。如果当前项目还没有保存
精确导师—项目和调查维度，请先展示与 Web 前端一致的完整选项并等待我确认，
不要自动按 Top N 开始。
```

```text
使用 advisor-evaluator 根据已有证据生成最终排名。
```

这种模式下，输出文件直接保存在你自己的申请项目文件夹中，不会出现在 Web 控制台的 `projects/` 列表里。

## 两种方式如何选择

| 需求 | 推荐方式 |
|---|---|
| 第一次使用，希望有填写引导 | Web 本地控制台 |
| 想在页面里看到 0/5、候选数量和任务进度 | Web 本地控制台 |
| 已经在 Codex Desktop 中管理科研项目 | 直接使用 Skills |
| 习惯在终端中使用 Codex 或 Claude Code | 直接使用 Skills |
| 希望完全控制自己的项目目录结构 | 直接使用 Skills |
| 希望在一个界面里管理多个申请项目 | Web 本地控制台 |

通常选择一种方式作为项目的主入口：选择 Web 时由 Web 管理 `projects/`；选择直接使用 Skills 时，在你自己创建的项目文件夹中完成全部工作。

## 递进式三阶段工作流

### 阶段 1：导师发现、研究匹配与客观申请筛选

`advisor-finder` 根据 CV、目标范围与研究兴趣：

- 按用户选择的 Top N 构建更大的目标院校或院系导师发现池
- 低成本核对身份、研究方向、代表作与官方招生信号
- 将导师映射到真实学校、项目、学位和申请季
- 对研究匹配后的 shortlist 补齐截止日期、学费、奖学金、材料、RP 和联系要求
- 单独给出客观申请可行性，不把 QS、费用或截止日期混入研究匹配分
- 记录来源并生成匹配结果

Finder 浏览导师或项目页面时已经发现的信息会立即保存；后续只查询缺失、过期或冲突字段。同一项目的信息只查一次，再关联到多位导师。

### 阶段 2：按勾选维度背景调查

`advisor-detective` 对选中的导师继续调查：

- 基础身份与当前职位、最近三年研究方向、近期项目与招生状态（新项目默认勾选）
- 研究产出与趋势
- 课题组成员及去向
- 指导环境、组内生态与工作方式
- 资源、funding、署名和职业支持
- 学术诚信、公开争议、国际学生支持及合作网络

不再使用 `shallow / medium / high`。前三项是默认背调起点，其余维度默认不选；用户勾选什么就调查什么，未选维度写“用户未选择复核”。Finder 已有且仍然有效的事实直接复用，只补缺失或过期内容。如果选择导师风评，可明确同意在当前项目本地下载社区资料。系统优先检索本地文本，再继续核查小红书、X/Twitter、Reddit 等相关来源。匿名内容只作为线索，不能直接改分。

### 阶段 3：最终排名

`advisor-evaluator` 分开汇总研究匹配、客观申请可行性和所选背调维度，生成申请就绪总表。

评分用于辅助筛选，不替代申请者对导师风格、招生状态和合作方式的独立判断。

## 四个 Skills

| Skill | 作用 |
|---|---|
| `advisor-finder` | 发现真实候选、完成研究匹配和客观申请筛选 |
| `advisor-detective` | 按用户勾选维度对重点导师进行证据化背景调查 |
| `advisor-evaluator` | 分开汇总主客观结论并生成申请就绪总表 |
| `advisor-pipeline` | 编排完整三阶段流程 |

Skills 源文件位于：

```text
skills/
├── advisor-finder/
├── advisor-detective/
├── advisor-evaluator/
└── advisor-pipeline/
```

## 输出与状态

根据执行阶段，项目可能产生：

- `ADVISOR_STATE.md`
- `DETECTIVE_STATE.md`
- `EVALUATOR_STATE.md`
- `advisor_shortlist_<日期>.xlsx`
- `advisor_detective_<日期>.xlsx`
- `advisor_application_ready_<日期>.xlsx`
- `outputs/candidates.json`
- `outputs/advisor_records.json`
- `outputs/program_records.json`
- `outputs/evidence.json`
- `outputs/detective-results.json`
- `outputs/ranking.json`
- `runs/<run-id>/events.ndjson`（Web 模式）

具体结果取决于使用的 Skill、搜索范围和模型是否完成了对应任务。

### 社区资料隐私与版权边界

- 公开仓库只保存来源链接、同步机制、证据规则和隐私规则，不保存下载快照。
- 公开可访问不等于获得再分发授权。
- 快照仅在用户明确同意后保存到当前申请项目本地，并可从页面清除。
- PDF 没有成功生成可搜索文本时，必须标记“未完成检索”，不能写“未发现记录”。
- 镜像、转载和同源引用不算多个独立证据。

## 常见问题

### Web 页面为什么显示候选导师、背调证据都是 0？

这是新项目的真实初始状态。只有导师搜索实际产生候选结果后，数字才会更新。

### Web 中“开始寻找导师”为什么不能点击？

每个阶段的前置条件不同，按钮读取的是同一份 readiness matrix：

| 阶段 | 必需条件 |
| --- | --- |
| Finder 1A（导师发现） | 目标院校或地区范围，且 CV 或至少一个研究兴趣（二选一） |
| Finder 1B（客观筛选） | 1A 已产出候选 + 目标学位 + 申请季 |
| Detective（背调） | 带稳定 `advisorProgramId` 的候选 + 与当前草稿一致的已确认配置 |
| Ranking（综合排名） | 至少一条 Detective 结果 |

所以“开始寻找导师”只需要第一行的两项；目标学位和申请季可以稍后补齐，研究兴趣权重是可选的（不填按等权处理，不需要凑满 100%）。

另外请确认 Codex 或 Claude 至少有一个显示为“可用”。如果 CV 上传后被移动或删除，页面会提示“原 CV 文件已不存在或被移动”——此时它不再算作有效的匹配信号，需要重新上传或改填研究兴趣。

### 关掉运行面板会不会把任务杀掉？

不会。关闭面板只是隐藏它，任务仍在后台运行，顶栏会显示“任务运行中”。点击它可以重新接回原任务，包括之前的日志和还没处理的授权请求；刷新页面同样会自动接回。要真正停止，请在面板底部点“取消任务”。

同一个申请项目同时只允许一个任务：重复启动会返回 409，并直接接回已经在跑的那个。不同项目之间仍可并行。

### 为什么模型说“做完了”，页面却显示“本轮已结束，但尚未产生 Phase 2 结果”？

因为完成状态以磁盘上的真实产物为准，而不是模型的最后一句话。后端会按阶段校验 `candidates.json` / `detective-results.json` / `ranking.json`：文件缺失、JSON 非法、结果为空，或者背调结果属于旧的确认版本，都会显示为 `partial` 并列出缺了什么。

### Web 为什么检测不到 Codex 或 Claude？

Web 使用的是本机 CLI 登录状态。请先在普通终端中确认对应命令已经安装并登录，然后在页面的运行面板中点击“刷新状态”。

### 运行任务时报错 “spawn EINVAL”，怎么办？

**这个问题已经修复，请更新到最新版本的项目代码。**

```bash
git pull
cd web
npm install
npm run dev
```

原因：旧版本在启动本地任务时，让子进程独立成新会话（`detached`）。该选项依赖的系统底层标志在部分系统上不被支持，会被直接拒绝并返回 `EINVAL`，任务因此在模型服务真正启动前就中断。

这个报错与以下因素**都无关**，不需要在这些方向排查：

- **Node.js 版本**：升级 Node 不能解决，新旧版本都会出现
- **所选模型**：Codex、Claude Code、自定义 API 三条路径都会遇到，因为它们经过同一段启动代码
- **网络或 API 配置**：报错时子进程尚未创建，还没有发出任何一次请求

如果更新代码后仍然报错，请提供 `node -v` 的输出，以及你的操作系统版本（macOS 运行 `sw_vers`，Windows 在“设置 → 系统 → 关于”中查看）。

如果升级 Node 后问题依旧，请换一个全新的普通终端窗口重新启动本地控制台（不要通过其他脚本或工具间接拉起），再试一次。

### 直接使用 Skills 时，为什么 Codex 或 Claude 没识别到？

检查：

- 当前打开的是否为正确申请项目文件夹
- Codex 是否使用 `.agents/skills/`
- Claude Code 是否使用 `.claude/skills/`
- 是否复制了完整 Skill 目录
- 是否在复制 Skills 后重新打开了会话

### 可以从 Web 切换到直接使用 Skills 吗？

可以。Web 创建的每个项目已经包含 `.agents/skills/` 和 `.claude/skills/`，两边共用同一套 schemaVersion 4 契约。

```bash
cd projects/<project-id>
node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD" --check
codex   # 或 claude
```

`--check` 是只读校验，会指出缺失或不合法的文件；不带 `--check` 会确定性地补齐结构，且不会覆盖已有的 Finder / Detective 产物。Web 与这些 CLI 写入脚本共用项目级文件锁；若另一个操作正在写入，会等待或明确提示稍后重试，不再各自基于旧快照覆盖 `project.json`。

选择阶段请用确定性脚本渲染菜单，不要让模型自由排版：

```bash
node .agents/skills/advisor-pipeline/scripts/render_investigation_menu.mjs --root "$PWD"
```

### 项目里的 skills 会随仓库更新吗？

不会自动更新。Web 每次启动任务前会把仓库当前的 skills 同步到该项目；但你手动复制到别处的项目文件夹是一份快照，仓库更新后不会跟着变。需要更新时重新复制一次：

```bash
cp -R /path/to/repo/skills/. .agents/skills/
cp -R /path/to/repo/skills/. .claude/skills/
```

复制不会覆盖 `inputs/`、`outputs/`、`project.json` 和社区缓存。

### 导师信息一定准确吗？

不一定。职位、招生状态和研究方向会变化，公开评价也可能存在偏差。发送邮件或提交申请前，应重新访问导师主页和院系官方页面确认关键信息。

## 开发与验证

面向普通用户的使用方式只有前面两种。下面的命令用于开发和测试，不是第三种产品使用方式。

```bash
cd web

# 构建并运行服务端渲染测试
npm test

# 单独构建
npm run build

# 只启动本地桥接服务，供开发调试
npm run runtime

# 查看桥接服务和模型状态
npm run backend -- health
```

更多本地后端命令和技术细节见 [`web/README.md`](web/README.md)。

主要目录：

```text
.
├── README.md
├── skills/
├── projects/              # Web 创建的本地申请项目，Git 忽略
└── web/
    ├── app/               # 前端界面
    ├── local-runtime/     # 本地执行桥接与 CLI
    ├── tests/
    └── README.md          # Web 层技术说明
```

控制台不会自动 commit、push、部署或发送邮件。

## 当前边界

- Web 自定义 API 当前要求兼容 OpenAI Responses API
- 背调质量取决于公开证据、网页可访问性和所选模型能力
- 复杂范围的导师搜索可能需要较长时间
- 最终排名是决策辅助，不是招生结果预测

---

Advisor Atlas 负责整理信息与证据，最终申请决策仍由你做出。

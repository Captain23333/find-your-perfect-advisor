# Advisor Atlas 本地控制台

`find-your-perfect-advisor` 的本地 Web 界面。当前版本包含：

完整的页面流程、完成态判断、输出文件约定和维护清单见
[前端使用与维护指引](../docs/FRONTEND_GUIDE.md)。

- 多个申请项目的独立目录、状态和运行记录
- Codex 订阅、Claude 订阅与自定义 Responses API 三种执行方式
- CV 上传、递进式三阶段工作流、客观申请筛选、候选导师和背调状态
- CV 不合格时在同一 run / Agent 会话中上传替换文件并继续
- 排名后的精确导师/材料/顺序确认，以及 LaTeX/BibTeX/PDF RP、可复制陶瓷信和本地文献核验包；页面直接列出引用，导师文献需通过本人署名或公开团队关系核验
- 精确导师—项目选择和勾选式调查维度
- 显式授权、刷新和清除的本地社区资料缓存
- 从网页启动、停止并实时查看本地 Agent 事件流
- 在网页中处理 Agent 的命令、文件和网络授权请求
- 不经过网页、直接从终端调用同一套后端

新项目从真实空白状态开始：CV、申请者姓名、目标学位、申请季、目标范围和研究兴趣均为空，界面只用“例如……”提示填写方式。候选导师、背调证据和最终排名也全部显示 `0`。

Phase 1 要求目标范围和一份可读取的真实 CV。研究兴趣和权重是 CV 之外的可选补充；提供兴趣但不填写权重时会自动等权。目标学位和申请季最迟在 shortlist 的客观申请条件筛选前补齐。RP 与套磁信还要求已确认的申请者真实姓名。用户可以设置希望保留的 shortlist 数量，默认 Top 10。

## 本地启动

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/`。这个命令会同时启动：

- Web 控制台：`http://localhost:3000/`
- 仅绑定本机的 Agent 桥接服务：`http://127.0.0.1:4318/`

这些命令同时支持 macOS、Linux、Windows PowerShell 和 Windows 命令提示符，
无需修改环境变量写法。请逐行执行，并确保 `node --version` 为 22.13.0 或更高
版本。

本地桥接服务会调用已登录的 Claude/Codex CLI。Custom API 也需要 Codex
app-server 作为本地 Agent 运行引擎；该运行引擎已作为 `web` 的 npm 依赖随
`npm install` 安装，使用 Custom API 时不要求登录 Codex。

## 项目目录

所有申请项目放在仓库根目录的 `projects/` 下，每个申请季或申请方向使用独立子目录：

```text
projects/
└── <project-id>/
    ├── project.json
    ├── status.json
    ├── inputs/
    ├── outputs/
    ├── community-cache/
    ├── runs/
    ├── .agents/skills/
    └── .claude/skills/
```

网页创建项目时只需填写一个容易辨认的项目名称；文件夹 ID 由后端自动生成。终端用户仍可按需传入 `--slug` 指定 ID。

- `inputs/`：CV 和用户输入
- `outputs/`：最终表格与报告；包含 `candidates.json`、`advisor_records.json`、`program_records.json` 和 `evidence.json`
- `community-cache/`：仅在用户明确同意后生成的第三方社区资料及可搜索文本
- `runs/<run-id>/`：每次运行的事件和元数据
- `.agents/skills/`：Codex 的项目级 Skills
- `.claude/skills/`：Claude Code 的项目级 Skills

网页和终端后端使用同一个项目目录。`projects/` 和运行配置目录 `.advisor-atlas/` 均已加入 Git 忽略列表，避免把个人申请材料误提交到仓库。

每次启动 Agent 前，后端会把仓库当前版本的全部 Skills（包括后置 RP 与套磁信 Skills）同步到项目的 `.agents/skills/` 和 `.claude/skills/`；个人 CV、输出、社区缓存和项目选择不会被覆盖。同步到磁盘不等于全部加载进模型上下文：每个 Web mode 只注入当前阶段的 Skill 入口和阶段约束，reference 再按当前动作读取。

每次运行阶段完成后会更新项目根目录的 `status.json`。Finder 会更新候选、导师、项目和证据记录；网页在运行结束后重新读取这些文件。候选行使用稳定的 `advisorProgramId`，同名导师或多项目不会仅靠姓名对齐。

## 运行上下文与续跑

- `finder`、`detective`、`ranking`、`research_proposal` 和 `outreach_email` 分别加载对应 Skill，不先读取完整 Pipeline 或其他阶段 Skill。
- 公共安全边界与当前 mode 的产物契约由本地 runtime 统一注入一次，前端只传当前任务意图。
- Agent 输出结构化 `input.requested` 后，运行状态变为 `needs_input`，底层进程和 provider thread 保持可继续。
- `cv` 请求使用专用上传控件；文件先写入当前项目，再调用原 run 的 continue endpoint，不创建新 run。
- 重复的 MCP/HTTP 重连只在主进度中保留最新累计提示，完整诊断仍在技术详情中。

## 调查范围与社区资料

- Finder 只做低成本发现与研究匹配，复用顺手遇到的身份、近期研究、代表作和官方招生信号，不提前执行社区风评或组内生态调查。
- 对 shortlist 复用已有事实并只补齐缺失的客观申请条件，然后用户再选择值得背调的导师—项目组合。
- Detective 不再使用 shallow、medium、high，而是保存精确 `selectedSections`。
- Detective 默认勾选基础身份与当前职位、最近三年研究兴趣与方向、近期项目与招生状态；其余维度默认不选。取消默认项时页面会警告信息可能不完整。
- 社区资料不会静默下载。只有用户勾选同意并主动开始相关调查或点击刷新后，本地后端才会下载和解析。
- PDF 由本地 Node 后端生成可搜索文本；失败时缓存状态为“不可搜索”，Agent 不得据此得出“未发现记录”。
- 页面提供清除本地资料按钮。

## 使用前提

- Codex：安装 CLI 并完成 `codex login`
- Claude Code：安装 CLI 并完成 Claude 账号登录
- 自定义 API：接口必须兼容 OpenAI Responses API，并提供 `GET /models`；界面会要求选择或填写接口实际返回的精确模型 ID。任务使用项目随附的 Codex app-server 运行，不要求登录 Codex

自定义 API Key 只保存在本地桥接服务的进程内存中，不写入项目文件或浏览器持久存储。连接元数据仅保存显示名称、Base URL、模型 ID 和协议，不保存 Key。

如果 Custom API 日志出现 `spawn codex ENOENT`，说明这是更新依赖前的旧安装，
不是中转站拒绝了请求。进入 `web` 目录重新执行 `npm install` 并重启控制台即可。

控制台默认使用项目写入边界，不启用完整磁盘访问，也不会自动 commit、push、部署或发送邮件。

## 网页授权流程

CLI 不再使用不可交互的单向输出模式：

- Claude Code 通过 `--permission-prompt-tool stdio` 发送结构化 `control_request`。
- Codex 和自定义 Responses API 通过 `codex app-server` 发送结构化 approval RPC。
- 本地后端把两种协议统一为网页授权卡片，显示工具、命令或路径、工作目录和申请理由。
- 用户可以选择“允许一次”“本次运行允许”或“拒绝”。未知控制请求默认拒绝。
- “本次运行允许”只复用同一命令入口或同一网络工具目标；其他操作仍会再次询问。

权限决定只存在当前运行进程中，不写入项目资料。停止任务时，仍在等待的请求会被拒绝并清理。

## 终端后端

保持 `npm run dev` 运行后，可以完全绕过前端，从另一个终端调用同一套后端：

```bash
# 查看运行环境和模型状态
npm run backend -- health

# 查看所有申请项目
npm run backend -- projects

# 新建独立申请项目
npm run backend -- create \
  --name "我的博士申请"

# 填写申请信息
npm run backend -- update \
  --project my-phd-application \
  --applicant-name "Your Real Name" \
  --season "2028 Fall" \
  --degree "PhD" \
  --target "美国 HCI / AI 项目" \
  --interests "Human-AI:60,AI4Health:40"

# 上传真实 CV
npm run backend -- upload \
  --project my-phd-application \
  --file "/absolute/path/Your_Name_CV.pdf"

# Phase 1 最低输入齐全后，在指定项目中运行本地 Codex
npm run backend -- run \
  --project my-phd-application \
  --provider codex \
  --prompt "执行 Phase 1 候选导师检索"

# 排名完成后先展示完整申请材料菜单，再明确确认
npm run backend -- materials-menu --project my-phd-application
npm run backend -- materials-confirm \
  --project my-phd-application \
  --advisor-id exact-advisor-program-id \
  --materials research_proposal,outreach_email \
  --order research_proposal,outreach_email \
  --confirmed-by-user

# 生成后在 CLI 直接查看分类、题名、作者、canonical URL 与本地 PDF 路径
npm run backend -- materials-status --project my-phd-application

# 按已确认顺序运行；后一个材料会等前一个产物通过校验
npm run backend -- run \
  --project my-phd-application \
  --mode research_proposal \
  --provider codex \
  --prompt "生成已确认目标的 Research Proposal"
```

创建成功后，命令会返回自动生成的项目 ID。后续命令把上面示例中的 `my-phd-application` 替换成该 ID；如果希望自己指定，也可以在创建命令末尾加 `--slug my-phd-application`。

`--provider` 还可以使用 `claude` 或已在网页中连接完成的 `custom`。自定义 API Key 只存在当前桥接进程内存，因此服务重启后需要重新连接。

## 验证

```bash
npm run build
npm test
npm run lint
```

Skill/Prompt 开销审计和风险决策见
[`../docs/SKILL_TOKEN_OPTIMIZATION.md`](../docs/SKILL_TOKEN_OPTIMIZATION.md)。

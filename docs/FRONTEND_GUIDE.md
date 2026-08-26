# Advisor Atlas 前端使用与维护指引

这份文档同时面向 Web 用户和后续维护前端的人。每次调整前端阶段、按钮、输出文件或 Skill 契约时，都必须同步更新本页。

## 用户看到的完整流程

### Phase 1：发现与客观筛选

1. 新建申请项目。
2. 填写目标范围。
3. 上传一份可读取的真实 CV；研究兴趣是可选补充，不能代替 CV。
4. 填写申请者真实姓名；Finder 不依赖姓名显示，但 RP 与套磁信会把它作为生成门槛。
5. 选择希望保留的 shortlist 数量。
6. 启动导师搜索。

Phase 1 完成后，前端展示 shortlist。此时选择真正感兴趣的导师—项目组合，再进入 Phase 2。Phase 1 不自动调查所有导师的社区风评。

### Phase 2：按需背调

1. 选择要调查的导师。
2. 勾选调查维度。
3. 如需使用第三方导师社区资料，单独授权本地下载。
4. 启动背调。

页面出现绿色的“P2 已完成”状态和“这轮背调已经完成”提示后，下面展示的是已完成结果，不需要再次点击背调。只有希望增加导师、增加维度或更新旧证据时，才使用“补充或重新背调”。

### 直接调用 Skills 时的同等流程

Codex CLI、Codex Desktop 或 Claude Code 直接调用 `advisor-pipeline` 时，
必须执行与上述页面相同的选择门，只是将复选框转换为编号菜单：

1. Phase 1 后展示真实 shortlist 中的导师—项目组合。
2. 用户选择精确组合，不能由 Agent 自动取 Top N。
3. 展示与前端相同顺序的 11 个调查维度，前三项默认选择。
4. 按导师数 × 维度数显示较低、中等或较高的预计消耗。
5. 涉及社区资料的维度单独询问本地下载授权，默认不允许。
6. 显示最终摘要并得到明确确认后，才保存配置并开始 Phase 2。

Web 复选框和 CLI 菜单在确认前都只是 `investigation.draft`。最终确认会
生成带 revision 和 fingerprint 的 `investigation.confirmed` 快照；Phase 2
和社区资料刷新只能使用仍与当前草稿一致的确认快照。修改任一导师、项目、
维度或社区资料选择后，必须重新确认。

直接调用 `advisor-detective` 时，如果项目尚未保存精确选择，也必须先
补做这套菜单，不得只要求用户填写内部 ID，也不得静默按排名开始。

正式运行会自动在当前项目的 `outputs/` 文件夹生成：

- `detective-results.json`：前端读取的结构化结果
- `advisor_detective_YYYYMMDD.xlsx`：完整背调工作簿

### Phase 3：综合排名与申请准备

Phase 3 复用 Phase 1 和 Phase 2 已有信息，不应重新执行导师发现。前端只展示排名前三位和最重要的待确认项。

正式运行会自动在当前项目的 `outputs/` 文件夹生成：

- `ranking.json`：前端读取的结构化排名
- `advisor_application_ready_YYYYMMDD.xlsx`：完整排名、证据、客观申请条件与申请准备信息

完整结果不需要从浏览器下载。页面会显示当前项目 `outputs/` 的本地路径，请直接在文件夹中打开 Excel。

### 排名后的申请材料（独立确认）

排名完成后，页面提供可选的 RP / 陶瓷信区。用户必须从完整排名中选择一个精确
`advisorProgramId`，勾选材料并确定顺序，再检查最终摘要并确认。草稿变化会立即
使旧确认失效；系统不会自动使用排名第一，也不会批量生成。

每个材料运行必须同时核验 `advisor_work` 与 `field_work`。实际引用文献从合法公开
来源下载到目标目录，manifest 记录 URL、公开获取依据、读取层级、本地路径、用途、
SHA-256 和文件大小。第二个材料只有在已确认顺序中的前一个材料通过产物校验后才解锁。
页面不会发送邮件或提交 RP。

## 如何判断一个阶段是否真的完成

前端不能只根据 `status.json` 中的阶段名称判断完成，因为中断的 Agent 可能已经提前更新状态。

- Phase 1 完成：`outputs/candidates.json` 是合法数组、至少一个候选，且每个候选都有稳定的 `advisorProgramId`。
- Phase 2 完成：`outputs/detective-results.json` 非空，`confirmedRevision` / `confirmedFingerprint` 与本次确认一致，每个已选维度都有结论或显式的 `not_completed` 标记。
- Phase 3 完成：`outputs/ranking.json` 是合法排名数组，且至少有一条带 `rank` 或可比较分数的结果。
- RP 完成：当前真实 CV 可读取且申请者姓名已确认；先记录目标项目官方文档类型、模板和篇幅；`research-proposal.tex`、`references.bib`、编译后的 `research-proposal.pdf`、`proposal-build.json` 和两个审计文件均存在，源码/PDF 哈希与确认版本一致。manifest 同时包含导师/团队与领域文献；导师文献必须记录可核验的本人署名或团队作者关系，领域文献不得把导师署名论文伪装成独立证据；BibTeX key 使用 literatureId，所有实际引用均有合法公开本地 PDF 并在 `proposal-evidence.md` 记录。若官方要求匿名 RP，姓名可不印在 PDF 上，但前置身份核验不能跳过。
- 陶瓷信完成：当前真实 CV 可读取、申请者姓名已确认且最终签名使用该姓名；干净可复制的 `outreach-email.txt` 与 `outreach-audit.md` 存在，并通过同样的文献包与关系证据校验；所有论文驱动的个性化在审计中记录 literatureId。Web 会直接列出 ID、分类、题名、作者、canonical URL 和本地路径。对外正文不得出现内部 TEST/DRAFT/DO NOT SEND/SUBMIT 标记。

这套校验由后端在任务结束时执行（`web/local-runtime/run-artifacts.mjs`），前端不再自行判断。运行状态因此有六种：

| 状态 | 含义 |
| --- | --- |
| `completed` | 模型正常结束，且产物通过校验 |
| `partial` | 模型正常结束，但产物缺失、非法或属于旧确认版本；界面会列出缺了什么 |
| `needs_input` | Agent 通过 `input.requested` 事件请求补充资料；原进程和 thread 保持存活，提交表单后由 `/continue` 在同一会话续跑 |
| `failed` | 模型或进程异常结束 |
| `cancelled` | 用户明确点了“取消任务” |
| `interrupted` | 本地运行服务在任务结束前重启，重启时自动改写 |

## 运行的并发与恢复

- 同一个项目同时只允许一个任务。重复 `POST /api/runs` 返回 409，并在 `activeRun` 中带上现有的 runId、mode、状态和开始时间。
- `GET /api/runs?projectId=` 返回 `{active, recent}`；`active` 里包含还没处理完的授权或资料请求。前端在加载和切换项目时调用它；若最近任务因服务重启成为 `interrupted`，顶栏会明确提示。
- `GET /api/runs/:runId/stream` 重新接入正在运行的任务：先回放事件缓冲，再推送 `run.attached`（含待处理授权），随后是实时事件。
- 关闭运行面板只隐藏面板，不会停止任务；顶栏保留“任务运行中”标志。停止是独立的 `POST /api/runs/:runId/stop`。
- `project.json` 的写入先经过进程内队列，再使用项目目录中的共享文件锁；Web 与独立 CLI 脚本也会互斥。文件本身通过临时文件 + rename 原子替换。

## 事件分级

运行事件带 `level` 字段：`progress` / `warning` / `action_required` / `error` / `diagnostic`。主日志只显示前四类；`diagnostic` 收进默认折叠的“技术细节”区。反复的连接失败（MCP、HTTP 5xx、socket hang up 等）合并成一条“模型工具连接不稳定，正在重试（第 N 次）”。分类优先看来源和流（`web/local-runtime/run-events.mjs`），正则只作兼容补充。

## 文件与数据边界

每个申请项目位于：

```text
projects/<project-id>/
├── project.json
├── status.json
├── inputs/
├── outputs/
├── community-cache/
└── runs/
```

- `project.json` 保存用户输入、调查草稿/确认快照，以及独立的申请材料草稿/确认快照；草稿不能直接授权背调、搜索文献或写材料。
- `status.json` 保存轻量阶段计数，不是结果内容的唯一依据。
- `outputs/` 保存 JSON、Excel 和报告。
- `runs/` 保存每次 Agent 运行事件。
- `community-cache/` 仅在用户明确授权后生成。

## Agent 权限

Codex、Claude Code 或自定义 API 需要命令、文件或网络权限时，前端运行面板会暂停并显示授权卡。

Custom API 并不是在浏览器中直接执行 Agent：本地后端使用项目随附的 Codex
app-server 驱动工具与授权协议，再把模型请求发送到用户填写的 Responses API。
`@openai/codex` 因此属于 Web 的运行依赖，但 Custom API 不要求 Codex 登录。
连接前必须先确认该本地运行引擎可启动；不能只凭 `GET /models` 成功就把整个
执行链标记为可用。

- “允许一次”：只允许当前请求。
- “本次运行允许”：只复用同类工具或同一命令入口。
- “拒绝”：拒绝当前操作，Agent 可选择替代方案或停止。

项目工作区内已经预授权的写入可能不会弹卡；这不代表前端遗漏了请求。

## 前端维护清单

调整工作流时，至少同时检查：

1. 页面按钮是否区分“首次运行”和“补充或重新运行”。
2. 完成态是否由真实输出文件驱动。
3. P2 是否默认先展示结果，而不是先展示配置表单。
4. P3 是否只展示前三名，并指向完整 Excel 所在的 `outputs/`。
5. Agent prompt 是否要求同步写入前端 JSON 和完整 Excel。
6. 精确导师 ID、`selectedSections` 和社区授权是否仍被持久化。
7. 权限卡是否能处理 Codex 和 Claude Code 的当前协议。
8. 桌面与窄屏布局是否都没有横向溢出。
9. `npm test`、`npm run lint` 和浏览器回归是否通过。
10. 本文档、根目录 `README.md` 和 `web/README.md` 是否同步更新。
11. CLI 是否仍展示与前端相同顺序的 11 个维度、默认三项、成本阈值和社区授权门。

## 本地启动

```bash
cd web
npm install
npm run dev
```

打开 <http://localhost:3000/>。前端和本地 Agent 桥接服务会一起启动。

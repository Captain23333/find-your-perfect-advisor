# Advisor Atlas 前端使用与维护指引

这份文档同时面向 Web 用户和后续维护前端的人。每次调整前端阶段、按钮、输出文件或 Skill 契约时，都必须同步更新本页。

## 用户看到的完整流程

### Phase 1：发现与客观筛选

1. 新建申请项目。
2. 填写目标范围。
3. 上传 CV，或至少填写一个研究兴趣。
4. 选择希望保留的 shortlist 数量。
5. 启动导师搜索。

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

## 如何判断一个阶段是否真的完成

前端不能只根据 `status.json` 中的阶段名称判断完成，因为中断的 Agent 可能已经提前更新状态。

- Phase 1 完成：`outputs/candidates.json` 有真实候选。
- Phase 2 完成：`outputs/detective-results.json` 有至少一条结果。
- Phase 3 完成：`outputs/ranking.json` 有至少一条排名。

只有满足对应产物条件，页面才显示“已完成”。中断但没有结果文件的任务仍应显示为待运行或待恢复。

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

- `project.json` 保存用户输入、调查草稿和最终确认快照；草稿不能直接授权背调。
- `status.json` 保存轻量阶段计数，不是结果内容的唯一依据。
- `outputs/` 保存 JSON、Excel 和报告。
- `runs/` 保存每次 Agent 运行事件。
- `community-cache/` 仅在用户明确授权后生成。

## Agent 权限

Codex、Claude Code 或自定义 API 需要命令、文件或网络权限时，前端运行面板会暂停并显示授权卡。

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

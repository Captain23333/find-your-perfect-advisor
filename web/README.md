# Advisor Atlas 本地控制台

`find-your-perfect-advisor` 的本地 Web 界面。当前版本包含：

- 多个申请项目的独立目录、状态和运行记录
- Codex 订阅、Claude 订阅与自定义 Responses API 三种执行方式
- CV 上传、三阶段工作流、候选导师和背调状态
- 从网页启动、停止并实时查看本地 Agent 事件流
- 不经过网页、直接从终端调用同一套后端

新项目从真实空白状态开始：CV、目标学位、申请季、目标范围和研究兴趣均为空，界面只用“例如……”提示填写方式。候选导师、背调证据和最终排名也全部显示 `0`。五项申请资料完成前，网页和后端都会阻止启动导师搜索。

## 本地启动

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/`。这个命令会同时启动：

- Web 控制台：`http://localhost:3000/`
- 仅绑定本机的 Agent 桥接服务：`http://127.0.0.1:4318/`

本地桥接服务只调用电脑上已经安装、已经登录的 Claude/Codex CLI。

## 项目目录

所有申请项目放在仓库根目录的 `projects/` 下，每个申请季或申请方向使用独立子目录：

```text
projects/
└── <project-id>/
    ├── project.json
    ├── status.json
    ├── inputs/
    ├── outputs/
    ├── runs/
    ├── .agents/skills/
    └── .claude/skills/
```

网页创建项目时只需填写一个容易辨认的项目名称；文件夹 ID 由后端自动生成。终端用户仍可按需传入 `--slug` 指定 ID。

- `inputs/`：CV 和用户输入
- `outputs/`：最终表格与报告；`candidates.json` 是前端候选表的数据源
- `runs/<run-id>/`：每次运行的事件和元数据
- `.agents/skills/`：Codex 的项目级 Skills
- `.claude/skills/`：Claude Code 的项目级 Skills

网页和终端后端使用同一个项目目录。`projects/` 和运行配置目录 `.advisor-atlas/` 均已加入 Git 忽略列表，避免把个人申请材料误提交到仓库。

每次运行阶段完成后会更新项目根目录的 `status.json`；导师搜索还会更新 `outputs/candidates.json`。网页在运行结束后重新读取这两个文件，所以通过终端执行得到的结果也能显示到前端。

## 使用前提

- Codex：安装 CLI 并完成 `codex login`
- Claude Code：安装 CLI 并完成 Claude 账号登录
- 自定义 API：接口必须兼容 OpenAI Responses API，并提供 `GET /models`；界面会要求选择或填写接口实际返回的精确模型 ID

自定义 API Key 只保存在本地桥接服务的进程内存中，不写入项目文件或浏览器持久存储。连接元数据仅保存显示名称、Base URL、模型 ID 和协议，不保存 Key。

控制台默认使用项目写入边界，不启用完整磁盘访问，也不会自动 commit、push、部署或发送邮件。

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
  --season "2028 Fall" \
  --degree "PhD" \
  --target "美国 HCI / AI 项目" \
  --interests "Human-AI:60,AI4Health:40"

# 上传真实 CV
npm run backend -- upload \
  --project my-phd-application \
  --file "/absolute/path/Your_Name_CV.pdf"

# 五项资料齐全后，在指定项目中运行本地 Codex
npm run backend -- run \
  --project my-phd-application \
  --provider codex \
  --prompt "执行 Phase 1 候选导师检索"
```

创建成功后，命令会返回自动生成的项目 ID。后续命令把上面示例中的 `my-phd-application` 替换成该 ID；如果希望自己指定，也可以在创建命令末尾加 `--slug my-phd-application`。

`--provider` 还可以使用 `claude` 或已在网页中连接完成的 `custom`。自定义 API Key 只存在当前桥接进程内存，因此服务重启后需要重新连接。

## 验证

```bash
npm run build
npm test
```

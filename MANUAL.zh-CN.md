# Codex ChatGPT Hub 说明书

## 1. 项目目的

Codex ChatGPT Hub 的目标是重新划分 ChatGPT 和 Codex 的职责：

```text
ChatGPT = 大脑 / 决策者 / 研究与验收
Codex   = 执行者 / 工程手 / 本地操作员
Hub     = 两者共享的任务、证据、执行记录和项目记忆
```

ChatGPT 更适合承担需要大量上下文推理、方案权衡、研究判断和最终决策的部分。Codex 更适合在本地环境里执行清晰任务：读代码、改文件、跑命令、查日志、生成 artifact、回传结果。

这个 Hub 不是为了把 ChatGPT 网页模型包装成 Codex tool，而是提供一层共享记忆和检索接口。ChatGPT 不需要直接看到 Codex 的隐藏推理过程；它需要看到的是可审计的外部事实：

- 任务目标、需求、约束和最终决策
- Codex 执行记录、命令输出、错误、日志和 diff
- 工作区搜索结果和文件片段
- 实验产物、指标、图表、报告和 artifact manifest
- 论文/研究项目中的 source、claim、evidence、framework、related-work anchor
- 当前 handoff、下一步、阻塞点和开放问题

这样可以把大量 token 消耗的思维博弈交还给 ChatGPT，只把最后的明确决策和可执行指令送给 Codex。Codex 执行后再把结果写回 Hub，ChatGPT 可以继续检索、验收和做下一轮决策。

## 2. 总体架构

```text
ChatGPT planning brain <-> MCP Hub <-> Codex execution agent
                              |
                         project context
                         task memory
                         plans/results
                         evidence trail
                         run/session logs
```

本项目同时提供两个 MCP 入口：

- `src/index.ts`：stdio MCP，给 Codex 本地使用。
- `src/http.ts`：HTTP MCP，给 ChatGPT Connector 或远端客户端使用。

默认记忆空间是 `default`，数据直接写入 `.data/`：

```text
.data/
  hub-state.json       # 任务、上下文、计划、执行结果
  paper-state.json     # 研究/论文记忆
  session-state.json   # Codex 执行现场镜像
  runs/                # 命令运行归档
  service/             # HTTP MCP pid 和日志
```

如果设置 `MCP_HUB_MEMORY_SPACE=paper-a`，共享记忆会写入独立目录：

```text
.data/
  service/             # 服务管理状态仍在根数据目录
  ngrok/               # tunnel 状态仍在根数据目录
  spaces/
    paper-a/
      hub-state.json
      paper-state.json
      session-state.json
      profile-state.json
      runs/
```

这样临时测试、论文项目、产品项目可以分别使用不同空间，避免共享记忆互相污染。

## 3. 快速部署

```bash
npm install
npm run build
npm run setup
npm run config -- install
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- start-watcher
```

然后打开本地 dashboard：

```text
http://127.0.0.1:3333/
```

在 ChatGPT Connector 里填写 dashboard 或 `npm run tunnel -- status` 显示的：

```text
https://xxxx.ngrok-free.dev/mcp
```

认证方式选择：

```text
No Auth
```

## 4. 本地开发

```bash
npm install
npm run typecheck
npm run build
```

常用检查：

```bash
npm run doctor
npm run tools
```

## 5. 本机配置

执行：

```bash
npm run setup
```

它会生成：

```text
.env
.data/
codex-config.generated.toml
```

默认不会生成 HTTP 访问密钥。如果旧 `.env` 里已经有 `MCP_HUB_HTTP_TOKEN=...`，删除这一行并执行 `npm run serve -- restart`，HTTP MCP 就会切回 No Auth 模式。

常见环境变量：

```bash
MCP_HUB_DATA_DIR=.data
MCP_HUB_MEMORY_SPACE=default
MCP_HUB_WORKSPACE=/absolute/path/to/Codex-ChatGPT-Hub
MCP_HUB_HTTP_HOST=127.0.0.1
MCP_HUB_HTTP_PORT=3333
# Optional. Leave unset for ChatGPT Connector "No Auth" mode.
# MCP_HUB_HTTP_TOKEN=change-me
MCP_HUB_PUBLIC_URL=https://xxxx.ngrok-free.dev
```

说明：

- `MCP_HUB_DATA_DIR`：Hub 根数据目录。
- `MCP_HUB_MEMORY_SPACE`：当前记忆空间。`default` 使用 `.data/`；其它名字使用 `.data/spaces/<name>/`。
- `MCP_HUB_WORKSPACE`：允许 MCP 搜索和读取的项目根目录。
- `MCP_HUB_HTTP_HOST` / `MCP_HUB_HTTP_PORT`：HTTP MCP 监听地址。
- `MCP_HUB_HTTP_TOKEN`：可选 HTTP Bearer token。默认不设置；ChatGPT Connector 快速部署使用 No Auth。
- `MCP_HUB_PUBLIC_URL`：ngrok 或其它公网 tunnel 地址。

## 6. 接入 Codex

推荐自动注入：

```bash
npm run config -- install
```

检查：

```bash
npm run config -- status
```

移除：

```bash
npm run config -- remove
```

预览但不写入：

```bash
npm run config -- install --dry-run
```

`install` 会写入 `~/.codex/config.toml` 中的托管区块，并在修改前生成 `.bak.<timestamp>` 备份。它只更新下面两个标记之间的内容，不覆盖你手写的其它配置：

```toml
# BEGIN CODEX CHATGPT HUB MANAGED MCP
# END CODEX CHATGPT HUB MANAGED MCP
```

手动配置可参考：

```toml
[mcp_servers.codex-chatgpt-hub]
command = "node"
args = ["/absolute/path/to/Codex-ChatGPT-Hub/dist/index.js"]
startup_timeout_sec = 10

[mcp_servers.codex-chatgpt-hub.env]
MCP_HUB_DATA_DIR = "/absolute/path/to/Codex-ChatGPT-Hub/.data"
MCP_HUB_MEMORY_SPACE = "default"
MCP_HUB_WORKSPACE = "/absolute/path/to/Codex-ChatGPT-Hub"
```

## 7. 启动 HTTP MCP

后台启动：

```bash
npm run serve
```

服务管理：

```bash
npm run serve -- status
npm run serve -- restart
npm run serve -- stop
npm run serve -- logs
npm run serve -- logs stderr
npm run serve -- foreground
```

默认地址：

```text
http://127.0.0.1:3333/mcp
```

dashboard：

```text
http://127.0.0.1:3333/
```

dashboard 会显示服务状态、Connector URL、Codex 配置、工具数量、memory 概览、run archive 和维护建议。

### 7.1 记忆空间隔离

如果同一个 Hub 同时服务多个项目，建议每个项目使用一个独立 `MCP_HUB_MEMORY_SPACE`：

```bash
MCP_HUB_MEMORY_SPACE=my-paper
```

设置位置：

1. 修改 `.env`。
2. 执行 `npm run config -- install`，让 Codex stdio MCP 也使用同一个空间。
3. 执行 `npm run serve -- restart`，让 HTTP MCP 重新读取空间配置。

空间名会被清洗成安全目录名，只保留字母、数字、`.`、`_` 和 `-`；其它字符会变成 `-`。

典型用法：

```bash
MCP_HUB_MEMORY_SPACE=default       # 主项目或旧数据
MCP_HUB_MEMORY_SPACE=scratch-test  # 临时测试
MCP_HUB_MEMORY_SPACE=paper-vision  # 某个论文项目
```

非默认空间的数据位置：

```text
.data/spaces/<space>/
```

服务 pid、HTTP 日志、ngrok 日志仍在根 `.data/service/` 和 `.data/ngrok/`，因为它们描述的是本机服务本身，不属于某个研究记忆空间。

## 8. 接入 ChatGPT Connector

ChatGPT 官网不能访问你的本机 `127.0.0.1`，所以需要 ngrok 或其它 tunnel 把本地 MCP 暴露成公网 HTTPS。

### 8.1 获取 ngrok authtoken

打开：

```text
https://dashboard.ngrok.com/get-started/your-authtoken
```

复制你的 token。

### 8.2 安装或检查 ngrok

```bash
npm run tunnel -- install
```

平台提示：

- macOS：会优先尝试 `brew install ngrok`。
- Linux：可以按 `npm run tunnel -- install --print-only` 输出的官方 apt 命令安装。
- Windows：仓库里已经带了 `ngrok.exe`，通常不用再安装；如果你删除了它，再用 `winget install ngrok.ngrok` 或打开 `https://ngrok.com/download` 下载。

### 8.3 配置 token 并启动 tunnel

```bash
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
```

它会自动：

- 配置 ngrok authtoken
- 确保本地 MCP 服务在线
- 启动 ngrok tunnel
- 读取公网 HTTPS URL
- 写入 `.env` 的 `MCP_HUB_PUBLIC_URL`
- 重启 HTTP MCP，让 dashboard 显示新的 Connector URL

检查：

```bash
npm run tunnel -- status
```

你需要看到类似：

```text
MCP health: ok
ngrok API: ok
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

### 8.4 ChatGPT 官网填写

在 ChatGPT 官网：

1. 点击左下角头像 / 账户菜单。
2. 进入 `Settings`。
3. 找到 `Connectors`。
4. 点击 `Create`、`New App` 或 `Add custom connector`。

建议填写：

```text
Name: Codex ChatGPT Hub
Description: Codex 和 ChatGPT 共用的 MCP 协作中转站
Connection: Server URL
Server URL: https://xxxx.ngrok-free.dev/mcp
Authentication: No Auth
```

注意：

- `Server URL` 一定要以 `/mcp` 结尾。
- 免费 ngrok 的 URL 可能变化。
- 当前快速部署使用 `No Auth`，不要选择 OAuth。

如果 ChatGPT 显示风险确认：

```text
Custom MCP servers introduce risk
```

勾选理解风险，然后点击 `Create` 和 `Connect`。

### 8.5 测试连接

新开一个 ChatGPT 对话，问：

```text
请使用 Codex ChatGPT Hub 列出当前可用 tools。
```

正常应该能看到：

```text
hub_*
paper_*
session_*
run_*
profile_*
```

也可以问：

```text
请调用 profile_overview 和 run_overview，确认 MCP Hub 当前状态。
```

### 8.6 URL 变化或需要重新认证

如果看到：

```text
This connection needs to be reauthenticated before ChatGPT can use it.
```

通常是 ngrok URL 变了。

本地运行：

```bash
npm run tunnel -- start
npm run tunnel -- status
```

复制新的 Connector URL，然后回到 ChatGPT Connector：

1. 点击这个 Connector。
2. 点击 `Reconnect`。
3. 如果仍失败，点击 `Disconnect`。
4. 删除旧 Connector 或重新编辑 URL。
5. 用新的 Connector URL 重新创建 / 连接。

### 8.7 日常启动顺序

```bash
npm run serve
npm run tunnel -- start
npm run tunnel -- start-watcher
```

`start-watcher` 会后台检查 ngrok 和 MCP 状态，断了会自动重连。

## 9. 新电脑迁移

### 9.1 从零开始

适合新用户，或不需要旧记忆：

```bash
git clone <你的仓库地址> mcp
cd mcp
npm install
npm run build
npm run setup
npm run config -- install
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- start-watcher
```

### 9.2 带旧电脑记忆迁移

如果只 clone 代码，新电脑会是干净 Hub。若要保留旧电脑上的任务、论文记忆、实验日志、run archive，需要迁移 `.data/`。

迁移整个 `.data/` 会带上所有记忆空间；如果只迁移某个项目空间，可以只复制 `.data/spaces/<space>/`，并在新电脑 `.env` 里设置相同的 `MCP_HUB_MEMORY_SPACE`。

旧电脑打包：

```bash
cd /path/to/Codex-ChatGPT-Hub
tar -czf mcp-data-backup.tar.gz .data
```

新电脑恢复：

```bash
cd mcp
tar -xzf /path/to/mcp-data-backup.tar.gz
```

确认：

```bash
ls .data
```

你应该能看到类似：

```text
hub-state.json
paper-state.json
session-state.json
runs/
```

然后重新生成新电脑配置：

```bash
npm run setup
npm run config -- install
npm run serve -- restart
```

不要直接照搬旧电脑 `.env`，因为路径和端口可能不同。

## 10. 工具层能力

### 10.1 Hub：任务协作记忆

默认写入 `.data/hub-state.json`。

主要工具：

- `hub_create_task`：创建协作任务
- `hub_list_tasks`：列出任务
- `hub_update_task_status`：更新任务状态
- `hub_append_context`：追加需求、约束、对话摘要、决策或日志
- `hub_post_plan`：写入 ChatGPT/Codex 的计划
- `hub_post_execution_result`：写入 Codex 执行结果、测试结果或阻塞点
- `hub_get_task_briefing`：读取某个任务的完整简报
- `hub_snapshot_workspace`：记录工作区文件列表、git branch、git status
- `hub_search_workspace`：用 ripgrep 搜索工作区
- `hub_read_file`：读取工作区内文本文件的有限行范围
- `hub_overview`：读取 hub 总览

### 10.2 Paper：研究/论文记忆

默认写入 `.data/paper-state.json`。

主要工具：

- `paper_create_project`：创建论文/科研项目工作区
- `paper_add_source`：记录论文、数据集、代码、网页或笔记来源
- `paper_import_literature_review`：导入完整论文调研 artifact
- `paper_read_literature_review`：按行读取调研 artifact
- `paper_grep_literature_review`：在调研 artifact 中 grep
- `paper_add_insight`：记录创新点、可行性、风险、实验想法和定位
- `paper_add_claim`：记录 claim，创建时必须带 evidence
- `paper_add_evidence`：继续给项目或 claim 绑定证据和 locator
- `paper_add_framework`：记录 framework，必须带 justification
- `paper_add_experiment`：记录实验设计、命令、指标、结果和产物
- `paper_add_figure`：登记图表路径、caption 和关联项
- `paper_upsert_outline`：创建或更新大纲章节，必须带 related-work anchor
- `paper_write_section`：保存某一节草稿，必须带 related-work anchor
- `paper_get_briefing`：读取论文写作所需的共享研究记忆
- `paper_search_memory`：搜索研究记忆
- `paper_overview`：读取总览

强约束：

```text
claim     -> evidence
framework -> justification
section   -> relatedWorkAnchor
```

这条链路是为了解决 ChatGPT 看不到 Codex 本地过程的问题。ChatGPT 不需要读隐藏推理，只要能看到结构化依据、理由和相关工作定位，就能继续做判断和验收。

### 10.3 Session：Codex 执行现场镜像

默认写入 `.data/session-state.json`。它不保存 Codex 的隐藏推理，而是保存可追溯执行现场。

主要工具：

- `session_create`：创建一次 Codex 执行会话镜像
- `session_append_event`：写入用户请求、Codex 更新、决策、文件、diff、artifact、错误或备注
- `session_add_command`：记录命令、退出码、耗时、stdout/stderr 尾部和摘要
- `session_upsert_handoff`：创建或更新 ChatGPT 接手所需的 handoff 包
- `session_get_handoff`：读取 handoff、近期事件和统计
- `session_search` / `session_grep`：搜索执行事件、命令摘要、handoff、artifact 和错误
- `session_read_event`：读取完整事件
- `session_overview`：读取总览

### 10.4 Run Archive：命令运行归档

`npm run wrap` 会自动生成 `.data/runs/run_xxx`：

```text
.data/runs/run_xxx/
  meta.json
  manifest.json
  stdout.log
  stderr.log
  diff.patch
  artifacts/
```

常用命令：

```bash
npm run wrap -- -- npm run build
npm run wrap -- --session-id sess_xxx -- npm run typecheck
npm run wrap -- --title "Stage 0 sanity" --project-id paper_xxx -- python train.py --config configs/debug.yaml
```

主要工具：

- `run_overview`
- `run_list`
- `run_get_meta`
- `run_read_log`
- `run_read_diff`
- `run_list_files`
- `run_get_manifest`
- `run_tag_artifact`
- `run_read_file`
- `run_grep`
- `run_rebuild_index`
- `run_cleanup`

`run_cleanup` 默认 dry-run。实际删除必须传：

```text
confirm: "DELETE_RUN_ARCHIVES"
```

### 10.5 Profile：连接形态记录

主要工具：

- `profile_list`
- `profile_overview`

用于记录 Codex stdio、ChatGPT HTTP、API relay、hybrid relay 等连接形态。

## 11. 推荐协作流

### 11.1 默认分工

```text
ChatGPT: 需求澄清、研究判断、方案权衡、计划、验收、下一步决策
Codex:   文件读写、代码修改、命令执行、实验运行、结果回传
Hub:     共享任务、证据链、执行记录、项目状态
```

### 11.2 检索策略

本项目默认采用 Grep/Search-first，而不是 RAG-first。

```text
handoff / briefing
-> grep 精确关键词、错误、函数名、实验 id、claim id
-> read bounded slice / read event
-> 再决定下一步 grep 或读取
```

原因：

- Coding Agent 和科研执行现场里，大量问题是精确检索：错误信息、文件名、函数名、run id、claim id、指标名。
- grep 的结果可定位、可引用、可复现，比默认 embedding 检索更适合代码和实验日志。
- RAG 可以作为未来插件，用于大规模论文库、工单库、经验库的模糊语义检索，但默认主线仍是结构化状态、grep/search 和分块读取。

### 11.3 ChatGPT 接手 Codex 工作时的推荐入口

```text
session_get_handoff      # 当前执行状态和下一步
session_grep             # 搜执行事件摘要
run_grep                 # 搜原始 stdout/stderr/diff
run_read_log/read_diff   # 分块读原始日志和 diff
hub_get_task_briefing    # 读任务上下文
hub_search_workspace     # 搜源码
hub_read_file            # 分块读源码
```

## 12. 示例流程

### 12.1 任务协作

```text
hub_create_task({ title, description, createdBy: "chatgpt" })
hub_append_context({ taskId, kind: "requirement", actor: "chatgpt", text })
hub_post_plan({ taskId, actor: "chatgpt", plan })
```

Codex 执行后：

```text
hub_snapshot_workspace({ actor: "codex" })
hub_post_execution_result({ taskId, actor: "codex", status, summary, details })
```

ChatGPT 继续读取：

```text
hub_get_task_briefing({ taskId })
hub_search_workspace({ query })
hub_read_file({ path, startLine, maxLines })
```

### 12.2 论文/研究协作

创建项目：

```text
paper_create_project({
  title,
  researchQuestion,
  createdBy: "chatgpt",
  keywords
})
```

记录 source：

```text
paper_add_source({
  projectId,
  type: "paper",
  title,
  authors,
  year,
  summary,
  contributions,
  limitations,
  citationKey
})
```

记录 claim，必须带 evidence：

```text
paper_add_claim({
  projectId,
  text,
  section: "experiments",
  priority: 1,
  evidence: {
    type: "experiment",
    source: "experiments/run_2026_06_17/results.json",
    locator: "table:main_metrics",
    summary: "The main metrics table supports this claim."
  }
})
```

记录 framework，必须带 justification：

```text
paper_add_framework({
  projectId,
  name: "Three-stage training framework",
  components: ["pretraining", "alignment", "evaluation"],
  justification: "This decomposition follows the training pipeline and keeps evidence, implementation, and evaluation boundaries inspectable.",
  claimIds,
  evidenceIds
})
```

维护章节，必须带 related-work anchor：

```text
paper_upsert_outline({
  projectId,
  name: "Introduction",
  bullets,
  claimIds,
  evidenceIds,
  relatedWorkAnchor: {
    citationKey: "smith2025survey",
    locator: "Section 2",
    summary: "Anchors the motivation against prior survey framing."
  }
})
```

Codex 写回实验：

```text
paper_add_experiment({ projectId, title, hypothesis, command, status: "planned" })
paper_add_evidence({ projectId, type: "experiment", source, locator, summary })
```

## 13. 常见问题

### 13.1 端口 3333 被占用

检查：

```bash
npm run serve -- status
```

重启：

```bash
npm run serve -- restart
```

如果仍不行，可以编辑 `.env`：

```bash
MCP_HUB_HTTP_PORT="3334"
```

然后：

```bash
npm run serve -- restart
npm run tunnel -- start
```

### 13.2 ChatGPT 连接失败

检查：

```bash
npm run tunnel -- status
```

确认：

```text
MCP health: ok
ngrok API: ok
Connector URL: https://xxxx.ngrok-free.dev/mcp
```

然后在 ChatGPT Connector 里重新填写这个 URL。

### 13.3 Codex 看不到 MCP

执行：

```bash
npm run config -- install
```

然后重启 Codex。

### 13.4 新电脑没有旧记忆

说明没有迁移 `.data/`。把旧电脑的 `.data/` 打包复制过来，再重启服务：

```bash
npm run serve -- restart
```

### 13.5 电脑休眠后断连

电脑睡眠后本地 MCP 和 ngrok 都可能断。重新启动：

```bash
npm run serve
npm run tunnel -- start
```

长期使用：

```bash
npm run tunnel -- start-watcher
```

### 13.6 不同项目的记忆混在一起

说明多个项目正在共用同一个 `MCP_HUB_MEMORY_SPACE`。给当前项目设置独立空间：

```bash
MCP_HUB_MEMORY_SPACE=my-project
```

然后执行：

```bash
npm run config -- install
npm run serve -- restart
```

之后新的 hub、paper、session、run、profile 记录都会写入 `.data/spaces/my-project/`。

## 14. 安全边界

- `hub_read_file` 只允许读取 `MCP_HUB_WORKSPACE` 目录内的文本文件。
- `hub_search_workspace` 只搜索 `MCP_HUB_WORKSPACE`。
- 默认跳过 `.git`、`.data`、`node_modules`、`dist` 等目录。
- 不要把 `.env`、密钥、私有凭据写进 hub context。
- 不要把 `.env`、`.data/`、`notes/`、`node_modules/`、`dist/` 提交到 GitHub。
- `paper_add_evidence` 支持短引用和 locator，但不要存入整篇受版权保护的论文原文。
- 论文写作时优先使用 `claim -> evidence -> source/experiment/figure` 链路，避免无证据主张。
- 当前快速部署使用 `Authentication: No Auth`，不要公开分享 ngrok URL。

## 15. GitHub 提交建议

确认 `.gitignore` 包含：

```text
.env
.data/
notes/
nanobot/
node_modules/
dist/
codex-config.generated.toml
```

首次提交：

```bash
git init
git add .
git status --short
git commit -m "Add Codex ChatGPT Hub"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

如果远程已有内容，但你确认要覆盖：

```bash
git push --force-with-lease -u origin main
```

若你明确要强制覆盖远程：

```bash
git push --force -u origin main
```

推送前检查本地测试材料未被跟踪：

```bash
git ls-files | findstr /i "notes"
```

没有输出最好。

## 16. 后续方向

- 增加更细的 allow/deny path 配置。
- 给 HTTP 模式补更完整的 OAuth / Bearer token 方案。
- 把 JSON store 换成 SQLite。
- 增加 `hub_claim_next_action` 和 `hub_post_review`。
- 增加 Codex 对话摘要自动注入命令。
- 增加 `paper_export_markdown`、`paper_export_latex`、`paper_export_docx`。
- 增加 source PDF 页码提取和引用格式导出。
- 增加向量检索，但保留结构化 claim/evidence 作为可信主线。

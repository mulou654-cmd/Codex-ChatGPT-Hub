# codex-chatgpt-hub

一个给 Codex 和 ChatGPT 共用的 MCP 协作中转站。

新电脑迁移和从零接入请看：[MIGRATION.zh-CN.md](./MIGRATION.zh-CN.md)。

ChatGPT 官网 Connector 点哪里、填哪里请看：[CHATGPT_CONNECTOR.zh-CN.md](./CHATGPT_CONNECTOR.zh-CN.md)。

目标不是把 ChatGPT 网页模型包装成 Codex tool，而是提供一层共享上下文：任务、需求、Codex 对话摘要、ChatGPT 计划、执行结果、测试输出、文件查询、工作区快照，以及科研论文写作所需的来源、主张、证据、实验、图表和草稿，都沉淀在同一个 hub 中。

```text
ChatGPT planning brain <-> MCP Hub <-> Codex execution agent
                              |
                         project context
                         task memory
                         plans/results
```

## 当前能力

V1 使用本地 JSON 文件持久化，默认写入 `.data/hub-state.json`。

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

仍保留 `hello_codex` 作为 MCP 连接烟测工具。

V2 新增科研论文记忆层，单独写入 `.data/paper-state.json`，不会破坏 V1 的 `hub_*` 数据。

- `paper_create_project`：创建论文/科研项目工作区
- `paper_list_projects`：列出论文工作区
- `paper_update_project_status`：更新论文项目状态
- `paper_add_note`：记录研究、写作、决策、TODO 或日志
- `paper_import_literature_review`：从 Codex 生成的 Markdown 文件导入完整论文调研 artifact
- `paper_add_literature_review`：从文本内容导入完整论文调研 artifact
- `paper_read_literature_review`：按行读取调研 artifact，支持 ChatGPT 分块完整阅读
- `paper_grep_literature_review`：在完整调研 artifact 中按行 grep，命中后再按行读取上下文
- `paper_add_insight`：记录 ChatGPT 基于调研产生的创新点、可行性、风险、实验想法和定位
- `paper_add_source`：记录论文、数据集、代码、网页或笔记来源
- `paper_add_claim`：记录论文中的主张、假设或贡献点
- `paper_add_evidence`：给项目或 claim 绑定证据和 locator
- `paper_add_experiment`：记录实验设计、命令、指标、结果和产物
- `paper_add_figure`：登记图表路径、caption 和关联 claim/experiment
- `paper_upsert_outline`：创建或更新论文大纲章节
- `paper_write_section`：保存某一节的草稿
- `paper_get_briefing`：读取论文写作所需的共享研究记忆
- `paper_search_memory`：搜索 V2 科研记忆
- `paper_overview`：读取 V2 总览

V3 新增 Codex Session Mirror，单独写入 `.data/session-state.json`。它不是保存 Codex 的隐藏推理，而是把 Codex 的外部执行现场沉淀成 ChatGPT 可接手、可检索的状态包。

- `session_create`：创建一次 Codex 执行会话镜像
- `session_list`：列出近期 session
- `session_update_status`：更新 session 状态
- `session_append_event`：写入用户请求、Codex 更新、决策、文件、diff、artifact、错误或备注
- `session_add_command`：记录命令、退出码、耗时、stdout/stderr 尾部和摘要
- `session_upsert_handoff`：创建或更新 ChatGPT 接手所需的 handoff 包
- `session_get_handoff`：读取 handoff、近期事件和统计
- `session_search`：搜索 session、事件、命令摘要、handoff、artifact 和错误
- `session_grep`：对 session 事件、命令摘要、stdout/stderr 尾部、路径和 metadata 做行级 grep
- `session_read_event`：根据 grep/search 命中的 eventId 读取完整事件
- `session_overview`：读取 V3 总览

Run Archive tools 读取 `npm run wrap` 自动生成的 `.data/runs/run_xxx`：

- `run_overview`：读取 run archive 总数、磁盘占用、退出码分布、artifact 类型统计和索引状态
- `run_list`：列出近期 run archive
- `run_get_meta`：读取某个 run 的命令、sessionId、退出码、耗时和日志路径
- `run_read_log`：按行读取 stdout/stderr
- `run_read_diff`：按行读取 diff.patch
- `run_list_files`：列出 run archive 内文件，包括 `artifacts/`
- `run_get_manifest`：读取或生成某个 run 的 `manifest.json`
- `run_tag_artifact`：把 artifact 标注为 `metrics`、`figure`、`report`、`table`、`config`、`checkpoint`、`dataset`、`log` 或 `other`
- `run_read_file`：按行读取 run archive 内文本 artifact
- `run_grep`：在 stdout、stderr、diff 和 meta 中做行级 grep
- `run_rebuild_index`：重建 `.data/runs/index.json`
- `run_cleanup`：预览或清理旧 run archive，默认 dry-run，实际删除必须传 `confirm: "DELETE_RUN_ARCHIVES"`

Connection Profile tools 记录非侵入式连接/注入形态：

- `profile_list`：列出 Codex stdio、ChatGPT HTTP、API relay、hybrid relay profile
- `profile_overview`：读取 profile 统计

这里借鉴了 `codex-plusplus` 的本地控制台、status/doctor 和配置驱动思路，但默认不 patch Codex.app。当前的 API relay / hybrid relay 是基础 profile，用来承载后续“ChatGPT/API 子代理 + Codex 执行 + Hub 共享记忆”的连接配置。

## 结构

```text
src/
  index.ts              # stdio MCP 入口，给 Codex 本地使用
  http.ts               # Streamable HTTP /mcp 入口，给 ChatGPT Connector 或远端客户端使用
  server.ts             # 共享 MCP server 工厂
  hub/
    config.ts           # 数据目录和工作区配置
    store.ts            # JSON 持久化和任务状态逻辑
    types.ts            # hub 数据模型
    workspace.ts        # 文件读取、搜索和 workspace snapshot
  paper/
    config.ts           # V2 paper state 路径
    store.ts            # 论文项目、来源、证据、实验、草稿的持久化
    types.ts            # V2 科研论文数据模型
  session/
    config.ts           # V3 session state 路径
    store.ts            # Codex 执行现场镜像和 handoff 逻辑
    types.ts            # V3 session 数据模型
  run/
    config.ts           # run archive 路径
    store.ts            # run manifest、索引、grep、cleanup 和 artifact 读取
  profile/
    store.ts            # 连接 profile：Codex stdio、ChatGPT HTTP、API relay、hybrid relay
  service/
    manager.ts          # HTTP MCP 后台服务的 pid/log/status 管理
  tools/
    hub.ts              # hub MCP tools
    paper.ts            # V2 paper MCP tools
    session.ts          # V3 session MCP tools
    run.ts              # run archive MCP tools
    profile.ts          # connection profile MCP tools
```

## 本地开发

```bash
npm install
npm run typecheck
npm run build
```

## 一键化接入

换一台电脑时，推荐走自动化向导，而不是手工拼配置。

```bash
npm install
npm run build
npm run setup
npm run config -- install
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
```

`npm run setup` 会生成：

- `.env`：本机数据目录、workspace、HTTP 端口和随机 token
- `.data/`：共享记忆数据目录
- `codex-config.generated.toml`：可复制到 Codex MCP 配置中的片段

也可以直接自动注入 Codex 配置：

```bash
npm run config -- status
npm run config -- install
npm run config -- remove
```

`install` 会写入 `~/.codex/config.toml` 中的托管区块，并在修改前生成 `.bak.<timestamp>` 备份。它只会更新下面两个标记之间的内容，不会覆盖你手写的其它配置：

```toml
# BEGIN CODEX CHATGPT HUB MANAGED MCP
# END CODEX CHATGPT HUB MANAGED MCP
```

想先预览可以用：

```bash
npm run config -- install --dry-run
```

`npm run serve` 会按 `.env` 以后台服务形式启动 HTTP MCP。打开：

```text
http://127.0.0.1:3333/
```

可以看到本地 dashboard：服务状态、Connector URL、Codex 配置、工具数量、memory 概览、run archive、artifact manifest 和维护建议。

HTTP MCP 服务管理：

```bash
npm run serve                 # 后台启动；已启动则复用
npm run serve -- status       # 查看 pid、health、URL、日志位置
npm run serve -- restart      # 自动停止旧服务并重启
npm run serve -- stop         # 停止后台 HTTP MCP
npm run serve -- logs         # 读取 stdout 日志尾部
npm run serve -- logs stderr  # 读取 stderr 日志尾部
npm run serve -- foreground   # 前台运行，适合调试
```

ngrok tunnel 管理：

```bash
npm run tunnel -- install                         # 自动检测/安装 ngrok；macOS 会优先用 Homebrew
npm run tunnel -- setup --authtoken YOUR_TOKEN    # 写入 ngrok authtoken，启动 tunnel，更新 MCP_HUB_PUBLIC_URL
npm run tunnel -- status                          # 检查本地 MCP、ngrok API、公网 URL
npm run tunnel -- start                           # 确保本地 MCP 与 ngrok tunnel 都在线
npm run tunnel -- stop                            # 停止 ngrok tunnel 和 watcher
npm run tunnel -- start-watcher                   # 后台守护，发现 ngrok/MCP 断开就自动重连
npm run tunnel -- stop-watcher                    # 停止后台守护
```

新用户最短路径：

```bash
npm install
npm run build
npm run setup
npm run config -- install
npm run serve
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- start-watcher
```

ngrok authtoken 可从这里拿：

```text
https://dashboard.ngrok.com/get-started/your-authtoken
```

平台安装说明：

- macOS：`npm run tunnel -- install` 会优先尝试 `brew install ngrok`
- Linux：按 `npm run tunnel -- install --print-only` 输出的官方 apt 命令安装
- Windows：推荐 `winget install ngrok.ngrok`，或打开 `https://ngrok.com/download` 下载

`tunnel setup/start` 会自动读取 ngrok 本地 API，拿到公网 HTTPS 地址后写回 `.env`：

```bash
MCP_HUB_PUBLIC_URL="https://xxxx.ngrok-free.dev"
```

如果公网地址变化，watcher 会重新写入 `.env` 并重启本地 HTTP MCP，让 dashboard 和 `/health` 显示新的 Connector URL。

常用检查命令：

```bash
npm run doctor
npm run tools
npm run wrap -- -- npm run build
```

- `doctor`：检查构建产物、`.env`、数据目录和 HTTP health
- `tools`：列出当前暴露的 `hub_*`、`paper_*` 工具
- `wrap`：执行命令并自动记录 stdout/stderr、exit code、耗时、diff 和 session handoff

`wrap` 的常用形式：

```bash
npm run wrap -- -- npm run build
npm run wrap -- --session-id sess_xxx -- npm run typecheck
npm run wrap -- --title "Stage 0 sanity" --project-id paper_xxx -- python train.py --config configs/debug.yaml
```

每次 wrapper 会写入：

```text
.data/runs/run_xxx/
  meta.json
  manifest.json
  stdout.log
  stderr.log
  diff.patch
  artifacts/
```

wrapper 会自动扫描 `artifacts/` 并生成 `manifest.json`。默认按文件名和扩展名推断：

```text
metrics / figure / report / table / config / checkpoint / dataset / log / other
```

如果自动推断不准，可以让 ChatGPT 或 Codex 调：

```text
run_tag_artifact({
  runId,
  path: "artifacts/metrics.json",
  kind: "metrics",
  label: "Stage 1 sanity metrics",
  tags: ["stage-1", "sanity"]
})
```

长期运行时建议定期：

```text
run_rebuild_index()
run_cleanup({ dryRun: true, maxAgeDays: 30, keepLast: 50 })
```

实际删除必须显式确认：

```text
run_cleanup({
  dryRun: false,
  maxAgeDays: 30,
  keepLast: 50,
  confirm: "DELETE_RUN_ARCHIVES"
})
```

同时会把命令摘要、输出尾部、run 路径和 handoff 写进 `session-state.json`，ChatGPT 可用 `session_grep` 和 `session_get_handoff` 检索。

实验脚本可以把产物写入 `artifacts/`，例如：

```text
.data/runs/run_xxx/artifacts/
  metrics.json
  eval_summary.md
  loss_curve.csv
  failure_cases.jsonl
```

ChatGPT 可通过：

```text
run_list_files({ runId })
run_read_file({ runId, path: "artifacts/metrics.json" })
run_grep({ runId, query: "accuracy" })
```

读取这些轻量 artifact。

ChatGPT 理解 Codex 构建的项目时，推荐入口顺序是：

```text
session_get_handoff      # 当前执行状态和下一步
session_grep             # 搜执行事件摘要
run_grep                 # 搜原始 stdout/stderr/diff
run_read_log/read_diff   # 分块读原始日志和 diff
hub_search_workspace     # 搜源码
hub_read_file            # 分块读源码
```

也就是说 ChatGPT 不会自动“全量看见”项目，但可以通过 MCP 精确检索源码、执行现场、日志和 diff，从而理解 Codex 构建的项目。

如果需要给 ChatGPT Connector 使用，用 ngrok 或 Cloudflare Tunnel 暴露本地服务，并把公网 HTTPS origin 写入 `.env`：

```bash
MCP_HUB_PUBLIC_URL="https://your-domain.example"
```

dashboard 会自动显示最终 Connector URL：

```text
https://your-domain.example/mcp
```

建议保留 `MCP_HUB_HTTP_TOKEN`，不要长期用无鉴权公网 tunnel。

Codex 本地 stdio 模式：

```bash
npm start
```

HTTP MCP 前台调试模式：

```bash
npm run serve -- foreground
```

默认监听：

```text
http://127.0.0.1:3333/mcp
```

## 环境变量

```bash
MCP_HUB_DATA_DIR=.data
MCP_HUB_WORKSPACE=/absolute/path/to/Codex-ChatGPT-Hub
MCP_HUB_HTTP_HOST=127.0.0.1
MCP_HUB_HTTP_PORT=3333
MCP_HUB_HTTP_TOKEN=change-me
```

- `MCP_HUB_DATA_DIR`：hub 状态文件目录
- `MCP_HUB_WORKSPACE`：允许 MCP 读取/搜索的项目根目录
- `MCP_HUB_HTTP_TOKEN`：HTTP 模式的 Bearer token；不设置则本地不鉴权

## 接入 Codex

先构建：

```bash
npm run build
```

推荐直接自动注入 Codex MCP 配置：

```bash
npm run config -- install
```

如果你想手动配置，也可以把下面配置加入 Codex 的 MCP 配置，或参考 `codex-config.example.toml`：

```toml
[mcp_servers.codex-chatgpt-hub]
command = "node"
args = ["/absolute/path/to/Codex-ChatGPT-Hub/dist/index.js"]
startup_timeout_sec = 10

[mcp_servers.codex-chatgpt-hub.env]
MCP_HUB_DATA_DIR = "/absolute/path/to/Codex-ChatGPT-Hub/.data"
MCP_HUB_WORKSPACE = "/absolute/path/to/Codex-ChatGPT-Hub"
```

## 接入 ChatGPT

ChatGPT Connector 需要可访问的 HTTPS MCP endpoint。第一版可以这样走：

1. 本地启动 HTTP MCP：

```bash
npm run setup
npm run serve
```

2. 用 Cloudflare Tunnel、ngrok 或其它安全隧道暴露本地 `http://127.0.0.1:3333/mcp`。
3. 在 ChatGPT Connector 中填写公开的 HTTPS `/mcp` URL。
4. 如果 Connector 支持自定义 header，加入：

```text
Authorization: Bearer your-secret
```

## 推荐协作流

### 检索策略：Grep/Search-first

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
- RAG 质量依赖分块和 embedding，不适合作为通用默认路径。

RAG 可以作为未来插件，用于大规模论文库、工单库、经验库的模糊语义检索。默认主线仍是结构化状态、grep/search 和分块读取。

### V1：任务协作流

1. Codex 创建任务：

```text
hub_create_task({ title, description, createdBy: "codex" })
```

2. Codex 写入当前对话摘要：

```text
hub_append_context({ taskId, kind: "conversation", actor: "codex", text })
```

3. Codex 记录工作区快照：

```text
hub_snapshot_workspace({ actor: "codex" })
```

4. ChatGPT 读取任务简报，并按需搜索/读取文件：

```text
hub_get_task_briefing({ taskId })
hub_search_workspace({ query })
hub_read_file({ path, startLine, maxLines })
```

5. ChatGPT 写入计划：

```text
hub_post_plan({ taskId, actor: "chatgpt", plan })
```

6. Codex 执行后写回结果：

```text
hub_post_execution_result({ taskId, actor: "codex", status, summary, details })
```

### V2：科研论文协作流

1. 创建论文项目：

```text
paper_create_project({
  title,
  researchQuestion,
  createdBy: "user",
  venue,
  keywords
})
```

2. 录入文献或来源：

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

3. 记录论文主张：

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

每个 claim 都必须在创建时带一条初始 evidence。这样 ChatGPT 读取 `paper_get_briefing` 时能直接看到主张和依据，而不是只看到一个待补证据的占位。

4. 继续绑定更多证据：

```text
paper_add_evidence({
  projectId,
  claimId,
  type: "experiment",
  source: "experiments/run_2026_06_17/results.json",
  locator: "table:main_metrics",
  summary
})
```

5. 记录 framework：

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

每个 framework 都必须带 `justification`，用于说明为什么采用这个框架、它解决什么组织或论证问题，以及 ChatGPT 继续写作时应如何理解这个结构。

6. 记录实验和图表：

```text
paper_add_experiment({ projectId, title, status: "completed", metrics, resultSummary })
paper_add_figure({ projectId, title, path, caption, claimIds, experimentIds })
```

7. 维护大纲和草稿：

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

paper_write_section({
  projectId,
  sectionName: "Introduction",
  content,
  author: "chatgpt",
  relatedWorkAnchor: {
    source: "related-work-notes.md",
    locator: "lines 20-44",
    summary: "Connects this section draft to the related-work contrast."
  }
})
```

每个 outline section 和 section draft 都必须带 `relatedWorkAnchor`。锚点可以是 `sourceId`、`reviewId`、`citationKey` 或自由文本 `source`，但必须有 `summary`。

8. ChatGPT 或 Codex 获取共同科研记忆：

```text
paper_get_briefing({ projectId })
paper_search_memory({ projectId, query })
```

### V2.1：从论文调研到创新点

你当前的推荐入口是：Codex 先根据一批论文生成完整调研总结，然后把这份总结作为一等 artifact 导入 Hub；ChatGPT 再完整读取调研并产出创新点、可行性分析、风险和实验想法；Codex 后续读取这些 insight 执行实验或代码工作。

1. 创建项目：

```text
paper_create_project({
  title: "视觉编码器与多模态感知研究",
  researchQuestion: "如何设计更适合 MLLM 的视觉编码器？",
  keywords: ["vision encoder", "MLLM", "distillation", "high resolution"],
  createdBy: "codex"
})
```

2. Codex 导入完整调研总结：

```text
paper_import_literature_review({
  projectId,
  sourcePath: "/absolute/path/to/Codex-ChatGPT-Hub/output/论文调研总结.md",
  title: "视觉编码器与多模态感知相关论文调研总结",
  kind: "survey",
  importedBy: "codex",
  tags: ["vision-encoder", "survey", "mllm"]
})
```

这个工具会保存完整 Markdown 内容，并自动建立 heading/line index。如果调研总结在 workspace 外部目录，可以通过 `MCP_HUB_IMPORT_ROOTS` 额外放行导入根目录。ChatGPT 可以先通过 `paper_get_briefing` 获取 reviewId 和章节索引，再分块读取：

```text
paper_read_literature_review({ projectId, reviewId, startLine: 1, maxLines: 120 })
paper_read_literature_review({ projectId, reviewId, startLine: 121, maxLines: 120 })
```

3. ChatGPT 写入创新点和可行性分析：

```text
paper_add_insight({
  projectId,
  kind: "innovation",
  title: "生成式视觉编码目标与多教师 dense 约束结合",
  text: "基于调研，可以探索以 Single-Transformer 语言建模作为主路径，同时引入 DINO/PE/RADIO 类 dense teacher 约束，以补足局部结构和空间感知。",
  reviewIds: [reviewId],
  status: "proposed",
  createdBy: "chatgpt"
})
```

4. Codex 读取 insight 并执行：

```text
paper_get_briefing({ projectId })
paper_search_memory({ projectId, query: "innovation" })
```

5. Codex 将实验设计和结果写回：

```text
paper_add_experiment({ projectId, title, hypothesis, command, status: "planned" })
paper_add_evidence({ projectId, type: "experiment", source, locator, summary })
```

这样调研总结、ChatGPT 的研究判断、Codex 的执行记录会进入同一个长期论文记忆，而不是散落在不同聊天窗口里。

推荐分工：

```text
ChatGPT: 研究判断、文献对比、claim 组织、论文草稿和验收
Codex: 代码、实验、数据整理、图表生成、结果回传
Hub V2: 证据链、实验记录、写作状态和长期共同记忆
```

### V3：Codex Session Mirror

V3 用来解决“ChatGPT 看不到 Codex 执行现场”的问题。它不追求同步 Codex 的隐藏推理，而是同步外部可追溯上下文：用户目标、关键决策、命令摘要、错误、文件/diff/artifact 指针和当前 handoff。

1. Codex 开始较长任务时创建 session：

```text
session_create({
  title,
  taskId,
  projectId,
  objective,
  workspaceRoot,
  createdBy: "codex",
  tags: ["stage-1", "experiment"]
})
```

2. 执行中写入高价值事件：

```text
session_append_event({
  sessionId,
  kind: "decision",
  actor: "codex",
  text: "Stage 1 only uses final patch-token teacher features; router is deferred."
})
```

3. 命令执行后写入摘要和输出尾部：

```text
session_add_command({
  sessionId,
  command: "npm run build",
  exitCode: 0,
  durationMs: 640,
  summary: "TypeScript build passed.",
  stdoutTail: "..."
})
```

4. Codex 写入 handoff，给 ChatGPT 接手：

```text
session_upsert_handoff({
  sessionId,
  summary,
  currentState,
  nextSteps,
  blockers,
  importantFiles,
  openQuestions
})
```

5. ChatGPT 按需读取和搜索：

```text
session_get_handoff({ sessionId })
session_search({ sessionId, query: "NaN" })
```

原则：

```text
Hub/Paper 存研究结论和长期记忆。
Session Mirror 存可追溯执行现场。
默认读 handoff；需要细节时再搜事件、命令尾部、artifact 和 diff 指针。
```

## 安全边界

- `hub_read_file` 只允许读取 `MCP_HUB_WORKSPACE` 目录内的文本文件。
- `hub_search_workspace` 只搜索 `MCP_HUB_WORKSPACE`。
- 默认跳过 `.git`、`.data`、`node_modules`、`dist` 等目录。
- 不要把 `.env`、密钥、私有凭据写进 hub context。
- V2 的 `paper_add_evidence` 支持短引用和 locator，但不要存入整篇受版权保护的论文原文。
- 论文写作时优先使用 `claim -> evidence -> source/experiment/figure` 链路，避免无证据主张。

## 下一步

- 增加更细的 allow/deny path 配置
- 给 HTTP 模式加 OAuth 或更完整的访问控制
- 把 JSON store 换成 SQLite
- 增加 `hub_claim_next_action` 和 `hub_post_review`
- 增加 Codex 对话摘要自动注入命令
- 增加 `paper_export_markdown`、`paper_export_latex`、`paper_export_docx`
- 增加 source PDF 页码提取和引用格式导出
- 增加向量检索，但保留结构化 claim/evidence 作为可信主线

# Codex ChatGPT Hub

![jaigou](photo/jaigou.png)

让 ChatGPT 重新做回大脑和决策者，让 Codex 回到纯粹执行者的位置。

这个项目不是要把 ChatGPT 包装成另一个代码工具，也不是让 Codex 在本地独自消耗大量 token 做完整的思维博弈。它提供一个共享 MCP Hub：ChatGPT 负责研究、权衡、计划、验收和决策；Codex 负责读写文件、运行命令、改代码、做实验、回传结果。两边通过同一套结构化记忆交换最终决策、证据链、执行记录、日志、文件片段和项目状态。

换句话说：

```text
ChatGPT = 大脑 / 决策者 / 研究与验收
Codex   = 执行者 / 工程手 / 本地操作员
Hub     = 两者共享的任务、证据、执行记录和项目记忆
```

ChatGPT 不需要直接看到 Codex 的隐藏思考过程。它需要看到的是可检索、可审计、可继续推进的外部事实：任务简报、工作区搜索结果、文件片段、Codex 执行记录、命令输出、实验产物、claim 的 evidence、framework 的 justification，以及 section 的 related-work anchor。

## 快速部署

### 1. 安装依赖并构建

```bash
npm install
npm run build
```

### 2. 生成本机配置

```bash
npm run setup
```

这会生成 `.env`、`.data/` 和 `codex-config.generated.toml`。

默认记忆空间是 `default`，兼容旧的 `.data/`。如果你在做临时测试或多个项目并行，先在 `.env` 里改：

```bash
MCP_HUB_MEMORY_SPACE=project-name
```

非默认空间会写到 `.data/spaces/project-name/`，避免测试记忆和正式项目混在一起。

### 3. 接入 Codex

```bash
npm run config -- install
```

然后重启 Codex，让它重新加载 MCP 配置。

检查：

```bash
npm run config -- status
```

### 4. 启动本地 MCP 服务

```bash
npm run serve
```

检查：

```bash
npm run serve -- status
npm run doctor
```

本地控制台：

```text
http://127.0.0.1:3333/
```

### 5. 接入 ChatGPT Connector

先配置 ngrok。

Windows 用户可以直接使用项目里的 `ngrok.exe`，不用再单独安装 ngrok；macOS / Linux 用户再运行安装命令：

```bash
npm run tunnel -- install
npm run tunnel -- setup --authtoken YOUR_NGROK_TOKEN
npm run tunnel -- start-watcher
```

查看 Connector URL：

```bash
npm run tunnel -- status
```

把输出里的这个地址填到 ChatGPT Connector：

```text
https://xxxx.ngrok-free.dev/mcp
```

认证方式选择：

```text
No Auth
```

默认部署不生成 HTTP 访问密钥；如果你之后需要 Bearer token，可以手动在 `.env` 添加 `MCP_HUB_HTTP_TOKEN=...`。

### 6. 日常启动

```bash
npm run serve
npm run tunnel -- start
npm run tunnel -- start-watcher
```

### 7. 常用检查

```bash
npm run doctor
npm run tools
npm run serve -- status
npm run tunnel -- status
```

## 详细说明

完整说明书见：

[MANUAL.zh-CN.md](./MANUAL.zh-CN.md)

里面包含：

- 项目架构和协作理念
- Codex / ChatGPT Connector 详细接入步骤
- 新电脑迁移和 `.data/` 记忆迁移
- Hub / Paper / Session / Run / Profile 工具说明
- 推荐协作流
- 常见问题
- 安全边界

## 不要提交的内容

`.gitignore` 默认排除了：

```text
.env
.data/
notes/
nanobot/
node_modules/
dist/
codex-config.generated.toml
```

其中 `notes/` 用于本地测试笔记或临时材料，`nanobot/` 用于本地参考项目，都不会上传到 GitHub。
